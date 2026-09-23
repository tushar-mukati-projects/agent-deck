import glob
import json
import os
import pwd
import re
import shutil
import subprocess
import sys

SHORT_LINE = 64 * 1024
PROMPT_CHARS = 4000
TEXT_CHARS = 24000
TYPE_RE = re.compile(rb'"type":"(user|assistant)"')
STRING_FIELD = {
    key: re.compile(rb'"' + key.encode() + rb'":"((?:[^"\\]|\\.)*)"')
    for key in ("timestamp", "cwd", "gitBranch", "version")
}
TEXT_BLOCK_RE = re.compile(rb'"type":"text","text":"((?:[^"\\]|\\.)*)"')
SIDECHAIN_RE = re.compile(rb'"isSidechain":(true|false)')
TOOL_FIELDS = ("description", "command", "file_path", "pattern", "url", "query", "prompt")
STRING_CONTENT_RE = re.compile(rb'"content":"((?:[^"\\]|\\.){0,4000})')
META_RE = re.compile(rb'"isMeta":(true|false)')
RELEVANT = (b'"type":"user"', b'"type":"assistant"', b'-title"', b'"last-prompt"')
SESSION_ID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
GIT = ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]


def claude_homes():
    homes = []
    override = os.environ.get("CLAUDE_CONFIG_DIR")
    if override:
        homes.append(override)
    homes += sorted(glob.glob("/home/*/.claude")) + ["/root/.claude"]
    seen, result = set(), []
    for home in homes:
        real = os.path.realpath(home)
        if real not in seen and os.path.isdir(os.path.join(home, "projects")):
            seen.add(real)
            result.append(home)
    return result


def decode(raw):
    for candidate in (raw, raw.rsplit(b"\\", 1)[0]):
        try:
            return json.loads(b'"' + candidate + b'"')
        except ValueError:
            continue
    return None


def field(chunk, key):
    match = STRING_FIELD[key].search(chunk)
    return decode(match.group(1)) if match else None


def is_system_text(text):
    trimmed = text.lstrip()
    return not trimmed or trimmed.startswith(("<", "Caveat:", "[Request interrupted", "This session is being continued"))


def prompt_text(content):
    if isinstance(content, str):
        return None if is_system_text(content) else content
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                if not is_system_text(block["text"]):
                    return block["text"]
    return None


def base_record(data):
    return {k: data.get(k) for k in ("type", "timestamp", "cwd", "gitBranch", "version", "isSidechain", "isMeta")}


def reduce_short(line):
    if not any(marker in line for marker in RELEVANT):
        return None
    try:
        data = json.loads(line)
    except ValueError:
        return None
    kind = data.get("type")
    if kind in ("custom-title", "ai-title", "last-prompt"):
        return {k: data.get(k) for k in ("type", "customTitle", "aiTitle", "lastPrompt")}
    if kind not in ("user", "assistant"):
        return None
    record = base_record(data)
    if kind == "user":
        text = prompt_text((data.get("message") or {}).get("content"))
        if text:
            record["message"] = {"content": text[:PROMPT_CHARS]}
    return record


def reduce_long(line):
    head, tail = line[:20000], line[-6000:]
    match = TYPE_RE.search(head[:1500]) or TYPE_RE.search(tail)
    if not match:
        return None
    kind = match.group(1).decode()
    record = {"type": kind}
    for key in ("timestamp", "cwd", "gitBranch", "version"):
        record[key] = field(tail, key) or field(head[:1500], key)
    side = SIDECHAIN_RE.search(head[:600])
    record["isSidechain"] = bool(side and side.group(1) == b"true")
    meta = META_RE.search(tail) or META_RE.search(head[:1500])
    record["isMeta"] = bool(meta and meta.group(1) == b"true")
    if kind == "user" and b'"tool_result"' not in head[:4000]:
        text = TEXT_BLOCK_RE.search(head) or STRING_CONTENT_RE.search(head)
        decoded = decode(text.group(1)) if text else None
        if decoded and not is_system_text(decoded):
            record["message"] = {"content": decoded[:PROMPT_CHARS]}
    return record


def compact(records):
    kept, pending, context, titles = [], None, None, {}
    for record in records:
        if record.get("type") in ("custom-title", "ai-title", "last-prompt"):
            titles[record["type"]] = record
            continue
        is_activity = record.get("type") in ("user", "assistant") and "message" not in record
        if not is_activity:
            if pending:
                kept.append(pending)
                pending = None
            kept.append(record)
            continue
        if record.get("isSidechain"):
            continue
        signature = (record.get("cwd"), record.get("gitBranch"), record.get("version"))
        if signature != context or not kept:
            kept.append(record)
            context = signature
            pending = None
        else:
            pending = record
    if pending:
        kept.append(pending)
    return kept + list(titles.values())


def read_complete_lines(path, offset):
    with open(path, "rb") as handle:
        handle.seek(offset)
        data = handle.read()
    end = data.rfind(b"\n")
    if end < 0:
        return [], offset
    return data[: end + 1].splitlines(), offset + end + 1


def index(request):
    offsets = request.get("offsets", {})
    files, changes = [], []
    for home in claude_homes():
        for path in glob.glob(os.path.join(home, "projects", "*", "*.jsonl")):
            try:
                stat = os.stat(path)
            except OSError:
                continue
            files.append(path)
            stamp = int(stat.st_mtime * 1000)
            known = offsets.get(path)
            if known and known["size"] == stat.st_size and known["mtime"] == stamp:
                continue
            start = known["offset"] if known and stat.st_size >= known["offset"] else 0
            lines, end = read_complete_lines(path, start)
            records = compact(
                record
                for line in lines
                if (record := reduce_short(line) if len(line) < SHORT_LINE else reduce_long(line))
            )
            changes.append({
                "path": path,
                "projectKey": os.path.basename(os.path.dirname(path)),
                "size": stat.st_size,
                "mtime": stamp,
                "start": start,
                "end": end,
                "records": records,
            })
    return {"files": files, "changes": changes, "live": live_sessions(), "shell": login_shell()}


def live_sessions():
    result = []
    for home in claude_homes():
        for path in glob.glob(os.path.join(home, "sessions", "*.json")):
            try:
                with open(path) as handle:
                    data = json.load(handle)
                pid = int(data.get("pid"))
                with open(f"/proc/{pid}/cmdline", "rb") as handle:
                    if b"claude" not in handle.read():
                        continue
            except (OSError, ValueError, TypeError):
                continue
            result.append({k: data.get(k) for k in ("pid", "sessionId", "cwd", "status", "kind", "name")})
    return result


def login_shell():
    try:
        return pwd.getpwuid(os.getuid()).pw_shell or "/bin/bash"
    except KeyError:
        return os.environ.get("SHELL", "/bin/bash")


def summarize_tool(block):
    detail = next(
        (block["input"][k] for k in TOOL_FIELDS if isinstance(block.get("input"), dict) and isinstance(block["input"].get(k), str)),
        None,
    )
    return {"type": "tool_use", "name": block.get("name"), "input": {"description": detail[:300]} if detail else {}}


def session_id_of(path):
    session_id = os.path.basename(path)[: -len(".jsonl")]
    if not path.endswith(".jsonl") or not SESSION_ID_RE.fullmatch(session_id):
        raise ValueError("not a Claude session file")
    return session_id


def transcript(path):
    session_home(path)
    out = []
    with open(path, "rb") as handle:
        for line in handle:
            try:
                data = json.loads(line)
            except ValueError:
                continue
            kind = data.get("type")
            if kind not in ("user", "assistant"):
                continue
            record = base_record(data)
            content = (data.get("message") or {}).get("content")
            if kind == "user":
                text = prompt_text(content)
                if not text:
                    continue
                record["message"] = {"content": text[:TEXT_CHARS]}
            else:
                blocks = content if isinstance(content, list) else [{"type": "text", "text": content or ""}]
                kept = []
                for block in blocks:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text" and (block.get("text") or "").strip():
                        kept.append({"type": "text", "text": block["text"][:TEXT_CHARS]})
                    elif block.get("type") == "tool_use":
                        kept.append(summarize_tool(block))
                if not kept:
                    continue
                record["message"] = {"content": kept}
            out.append(record)
    return {"lines": out}


def in_projects(path):
    real = os.path.realpath(path)
    return path.endswith(".jsonl") and any(
        os.path.dirname(os.path.dirname(real)) == os.path.realpath(os.path.join(home, "projects"))
        for home in claude_homes()
    )


def delete(path):
    if not in_projects(path):
        raise ValueError("not a Claude session file")
    session_id = session_id_of(path)
    home = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(path))))
    os.remove(path)
    for extra in (path[: -len(".jsonl")], os.path.join(home, "file-history", session_id), os.path.join(home, "session-env", session_id)):
        if os.path.isdir(extra):
            shutil.rmtree(extra, ignore_errors=True)
    try:
        os.rmdir(os.path.dirname(path))
    except OSError:
        pass
    return {"deleted": path}


def list_files(root):
    try:
        output = subprocess.run(
            GIT + ["-C", root, "ls-files", "-co", "--exclude-standard"],
            capture_output=True, timeout=20, check=True,
        ).stdout.decode("utf-8", "replace")
        return {"files": [line for line in output.splitlines() if line][:60000]}
    except (OSError, subprocess.SubprocessError):
        pass
    found = []
    for directory, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "target", ".venv", "__pycache__")]
        for name in names:
            found.append(os.path.relpath(os.path.join(directory, name), root))
            if len(found) >= 60000:
                return {"files": found}
    return {"files": found}


EDIT_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
MAX_DIFF_BYTES = 2 * 1024 * 1024


def session_home(path):
    if not in_projects(path):
        raise ValueError("not a Claude session file")
    session_id_of(path)
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(path))))


def read_text(path):
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > MAX_DIFF_BYTES:
            return None
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError:
        return None
    return None if b"\0" in data[:8192] else data.decode("utf-8", "replace")


def line_stats(before, after):
    import difflib

    additions = deletions = 0
    for line in difflib.unified_diff(before.splitlines(), after.splitlines(), n=0, lineterm=""):
        if line.startswith("+") and not line.startswith("+++"):
            additions += 1
        elif line.startswith("-") and not line.startswith("---"):
            deletions += 1
    return additions, deletions


def changes(path):
    home = session_home(path)
    session_id = os.path.basename(path)[: -len(".jsonl")]
    backups = os.path.join(home, "file-history", session_id)
    cwd, tracked = "", {}
    with open(path, "rb") as handle:
        for line in handle:
            snapshot, tool = b'"file-history-snapshot"' in line, b'"tool_use"' in line
            if not (snapshot or tool or (not cwd and b'"cwd"' in line)):
                continue
            try:
                data = json.loads(line)
            except ValueError:
                continue
            cwd = cwd or data.get("cwd") or ""
            if data.get("type") == "file-history-snapshot":
                for target, backup in ((data.get("snapshot") or {}).get("trackedFileBackups") or {}).items():
                    entry = tracked.setdefault(target, {"hash": None, "edits": 0})
                    name = (backup or {}).get("backupFileName")
                    if not entry["hash"] and name:
                        entry["hash"] = name.split("@")[0]
            elif data.get("type") == "assistant":
                for block in (data.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") in EDIT_TOOLS:
                        target = (block.get("input") or {}).get("file_path") or (block.get("input") or {}).get("notebook_path")
                        if target:
                            tracked.setdefault(target, {"hash": None, "edits": 0})["edits"] += 1
    merged = {}
    for target, info in tracked.items():
        absolute = os.path.normpath(target if os.path.isabs(target) or not cwd else os.path.join(cwd, target))
        entry = merged.setdefault(absolute, {"hash": None, "edits": 0})
        entry["edits"] += info["edits"]
        entry["hash"] = entry["hash"] or info["hash"]
    files = []
    for absolute, info in sorted(merged.items()):
        backup = f"{info['hash']}@v1" if info["hash"] else None
        if backup and not os.path.isfile(os.path.join(backups, backup)):
            backup = None
        exists = os.path.isfile(absolute)
        if not backup and not exists:
            continue
        before = read_text(os.path.join(backups, backup)) if backup else None
        after = read_text(absolute) if exists else None
        if not backup:
            status = "added"
        elif not exists:
            status = "deleted"
        else:
            status = "unchanged" if before is not None and before == after else "modified"
        additions, deletions = line_stats(before or "", after or "")
        files.append({"path": absolute, "status": status, "additions": additions, "deletions": deletions, "edits": info["edits"], "backup": backup})
    return {"files": files}


def backup(path, name):
    if not re.fullmatch(r"[0-9a-f]+@v\d+", name):
        raise ValueError("invalid backup name")
    session_id = os.path.basename(path)[: -len(".jsonl")]
    text = read_text(os.path.join(session_home(path), "file-history", session_id, name))
    if text is None:
        raise ValueError("Backup not available")
    return {"text": text}


def git_status(root):
    top = subprocess.run(GIT + ["-C", root, "rev-parse", "--show-toplevel"], capture_output=True, check=True, timeout=15).stdout.decode().strip()
    out = subprocess.run(GIT + ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], capture_output=True, check=True, timeout=15).stdout
    entries = [e for e in out.split(b"\0") if e]
    result, index = [], 0
    while index < len(entries):
        text = entries[index].decode("utf-8", "replace")
        index += 1
        if len(text) < 4:
            continue
        code = text[:2].strip() or "M"
        if code[0] in "RC":
            index += 1
        result.append({"path": os.path.join(top, text[3:]), "code": code})
    return {"changes": result}


def git_head(path):
    directory, name = os.path.split(path)
    out = subprocess.run(GIT + ["-C", directory, "show", f"HEAD:./{name}"], capture_output=True, timeout=15)
    if out.returncode != 0:
        raise ValueError(out.stderr.decode("utf-8", "replace").strip() or "not in HEAD")
    return {"text": out.stdout.decode("utf-8", "replace")}


def rename(path, title):
    session_home(path)
    title = title.strip()
    if not title:
        raise ValueError("Title can't be empty")
    session_id = os.path.basename(path)[: -len(".jsonl")]
    record = json.dumps({"type": "custom-title", "customTitle": title, "sessionId": session_id}, ensure_ascii=False)
    with open(path, "rb") as handle:
        handle.seek(0, os.SEEK_END)
        needs_newline = False
        if handle.tell():
            handle.seek(-1, os.SEEK_END)
            needs_newline = handle.read(1) != b"\n"
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(("\n" if needs_newline else "") + record + "\n")
    return {"renamed": path}


def search(query):
    needle = query.strip().lower()
    hits = []
    if len(needle) < 2:
        return {"hits": hits}
    raw_needle = needle.encode()
    for home in claude_homes():
        for path in glob.glob(os.path.join(home, "projects", "*", "*.jsonl")):
            session_id = os.path.basename(path)[: -len(".jsonl")]
            found = 0
            with open(path, "rb") as handle:
                for line in handle:
                    if raw_needle not in line.lower():
                        continue
                    try:
                        data = json.loads(line)
                    except ValueError:
                        continue
                    if data.get("type") not in ("user", "assistant") or data.get("isSidechain"):
                        continue
                    content = (data.get("message") or {}).get("content")
                    texts = [prompt_text(content)] if data["type"] == "user" else [
                        b.get("text", "") for b in (content if isinstance(content, list) else [{"text": content or ""}])
                        if isinstance(b, dict) and b.get("type", "text") == "text"
                    ]
                    for text in filter(None, texts):
                        index = text.lower().find(needle)
                        if index < 0:
                            continue
                        start, end = max(0, index - 90), min(len(text), index + len(needle) + 90)
                        snippet = " ".join(text[start:end].split())
                        hits.append({
                            "sessionId": session_id,
                            "role": data["type"],
                            "snippet": ("…" if start else "") + snippet + ("…" if end < len(text) else ""),
                            "timestamp": data.get("timestamp"),
                        })
                        found += 1
                    if found >= 3:
                        break
    return {"hits": hits}


def main():
    mode = sys.argv[1]
    if mode == "index":
        result = index(json.load(sys.stdin))
    elif mode == "transcript":
        result = transcript(sys.argv[2])
    elif mode == "delete":
        result = delete(sys.argv[2])
    elif mode == "files":
        result = list_files(sys.argv[2])
    elif mode == "changes":
        result = changes(sys.argv[2])
    elif mode == "backup":
        result = backup(sys.argv[2], sys.argv[3])
    elif mode == "git_status":
        result = git_status(sys.argv[2])
    elif mode == "git_head":
        result = git_head(sys.argv[2])
    elif mode == "search":
        result = search(sys.stdin.read())
    elif mode == "rename":
        result = rename(sys.argv[2], sys.stdin.read())
    else:
        raise ValueError(f"unknown mode {mode}")
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stdout.write(json.dumps({"error": str(error)}))
        sys.exit(1)
