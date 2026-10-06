import glob
import json
import os
import pwd
import re
import shutil
import signal
import subprocess
import sys
import time

PROMPT_CHARS = 4000
TEXT_CHARS = 24001
TOOL_CHARS = 1000
PATCH_CHARS = 1000000
LONG_LINE = 64 * 1024
SNIFF_BYTES = 8192
HUGE_LINE = 16 * 1024 * 1024
INDEX_BUDGET = 1024 * 1024 * 1024
SEARCH_LINES_PER_FILE = 20
MAX_LIST = 60000
TOP_KEYS = ("type", "timestamp", "cwd", "gitBranch", "version", "isSidechain", "isMeta")
TITLE_KEYS = ("type", "customTitle", "aiTitle", "lastPrompt")
TITLE_TYPES = ("custom-title", "ai-title", "last-prompt")
TOOL_FIELDS = ("description", "command", "file_path", "pattern", "url", "query", "prompt")
RELEVANT = (b'"type":"user"', b'"type":"assistant"', b'-title"', b'"last-prompt"')
CODEX_INDEX_MARKERS = (b'"session_meta"', b'"user_message"', b'"turn_context"')
CODEX_FULL_MARKERS = CODEX_INDEX_MARKERS + (b'"agent_message"', b'"function_call"', b'"custom_tool_call"')
HUGE_FIELDS = {
    key: re.compile(rb'"' + key.encode() + rb'":"((?:[^"\\]|\\.)*)"')
    for key in ("type", "timestamp", "cwd", "gitBranch", "version")
}
FLAG_FIELDS = {key: re.compile(rb'"' + key.encode() + rb'":(true|false)') for key in ("isSidechain", "isMeta")}
TIMESTAMP_RE = re.compile(rb'"timestamp":"([^"]+)"')
SESSION_ID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
GIT = ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false"]
EDIT_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
MAX_DIFF_BYTES = 2 * 1024 * 1024
EXACT_DIFF_LINES = 4000
NOISY_DIRS = (".git", "node_modules", "target", ".next", "__pycache__", ".venv")
TASK_LINE_LIMIT = 256 * 1024
TASK_MARKERS = (
    b'"run_in_background":true',
    b'"backgroundTaskId"',
    b"running in background with ID",
    b"<task-notification>",
    b'"name":"TaskStop"',
    b'"name":"KillShell"',
)


def homes(variable, name, marker):
    candidates = []
    override = os.environ.get(variable)
    if override:
        candidates.append(override)
    candidates += sorted(glob.glob("/home/*/" + name)) + ["/root/" + name]
    seen, result = set(), []
    for home in candidates:
        real = os.path.realpath(home)
        if real not in seen and os.path.isdir(os.path.join(real, marker)):
            seen.add(real)
            result.append(real)
    return result


def claude_homes():
    return homes("CLAUDE_CONFIG_DIR", ".claude", "projects")


def codex_homes():
    return homes("CODEX_HOME", ".codex", "sessions")


def claude_files():
    for home in claude_homes():
        for path in glob.glob(os.path.join(home, "projects", "*", "*.jsonl")):
            yield path


def codex_files():
    for home in codex_homes():
        for path in glob.glob(os.path.join(home, "sessions", "*", "*", "*", "rollout-*.jsonl")):
            yield path


def resolve_session(path):
    real = os.path.realpath(path)
    name = os.path.basename(real)
    if not real.endswith(".jsonl"):
        raise ValueError("not a session file")
    for home in codex_homes():
        root = os.path.join(home, "sessions") + os.sep
        if real.startswith(root) and name.startswith("rollout-") and SESSION_ID_RE.fullmatch(name[:-6][-36:]):
            return {"path": real, "codex": True, "home": home, "id": name[:-6][-36:]}
    for home in claude_homes():
        if os.path.dirname(os.path.dirname(real)) == os.path.join(home, "projects") and SESSION_ID_RE.fullmatch(name[:-6]):
            return {"path": real, "codex": False, "home": home, "id": name[:-6]}
    raise ValueError("not a session file")


def text_of(value):
    return value if isinstance(value, str) else ""


def has_tool_result(content):
    return isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def slim_input(value):
    if not isinstance(value, dict):
        return {}
    return {k: value[k][:TOOL_CHARS] for k in TOOL_FIELDS if isinstance(value.get(k), str)}


def slim_content(content, limit, assistant):
    if isinstance(content, str):
        return content[:limit]
    if not isinstance(content, list):
        return None
    blocks = []
    for block in content:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind == "text":
            blocks.append({"type": "text", "text": text_of(block.get("text"))[:limit]})
        elif kind == "tool_use" and assistant:
            blocks.append({"type": "tool_use", "name": block.get("name"), "input": slim_input(block.get("input"))})
        elif not assistant:
            blocks.append({"type": kind})
    return blocks


def top_level(data, keys):
    return {k: data[k] for k in keys if k in data}


def huge_record(line):
    head, tail = line[:4000], line[-4000:]
    record = {}
    for key, pattern in HUGE_FIELDS.items():
        match = pattern.search(head) or pattern.search(tail)
        if match:
            try:
                record[key] = json.loads(b'"' + match.group(1) + b'"')
            except ValueError:
                pass
    for key, pattern in FLAG_FIELDS.items():
        match = pattern.search(head) or pattern.search(tail)
        record[key] = bool(match and match.group(1) == b"true")
    return record if record.get("type") in ("user", "assistant") else None


def loads(line):
    try:
        data = json.loads(line)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def is_bulky(line):
    if len(line) > HUGE_LINE:
        return True
    if len(line) <= LONG_LINE:
        return False
    head = line[:SNIFF_BYTES]
    match = HUGE_FIELDS["type"].search(head)
    kind = match.group(1) if match else b""
    return kind == b"assistant" or (kind == b"user" and b'"tool_result"' in head)


def claude_index_record(line):
    if is_bulky(line):
        return huge_record(line)
    if not any(marker in line for marker in RELEVANT):
        return None
    data = loads(line)
    if data is None:
        return None
    kind = data.get("type")
    if kind in TITLE_TYPES:
        return top_level(data, TITLE_KEYS)
    if kind not in ("user", "assistant"):
        return None
    record = top_level(data, TOP_KEYS)
    message = data.get("message")
    if kind == "user" and isinstance(message, dict) and not data.get("isMeta") and not data.get("isSidechain"):
        content = message.get("content")
        if not has_tool_result(content):
            slim = slim_content(content, PROMPT_CHARS, False)
            if slim:
                record["message"] = {"content": slim}
    return record


def claude_full_record(line):
    if b'"type":"user"' not in line and b'"type":"assistant"' not in line:
        return None
    data = loads(line)
    if data is None or data.get("type") not in ("user", "assistant") or data.get("isSidechain"):
        return None
    message = data.get("message")
    if not isinstance(message, dict):
        return None
    assistant = data["type"] == "assistant"
    content = message.get("content")
    if not assistant and (data.get("isMeta") or has_tool_result(content)):
        return None
    slim = slim_content(content, TEXT_CHARS, assistant)
    if not slim:
        return None
    record = top_level(data, TOP_KEYS)
    record["message"] = {"content": slim}
    return record


def slim_arguments(arguments):
    if not isinstance(arguments, str):
        return None
    try:
        value = json.loads(arguments)
    except ValueError:
        return None
    if not isinstance(value, dict):
        return None
    kept = {}
    for key, item in value.items():
        limit = PATCH_CHARS if key in ("input", "patch") else TOOL_CHARS
        if isinstance(item, str):
            kept[key] = item[:limit]
        elif isinstance(item, list) and all(isinstance(part, str) for part in item):
            kept[key] = [part[:TOOL_CHARS] for part in item]
    return json.dumps(kept, ensure_ascii=False)


def codex_record(line, full):
    if (not full and len(line) > HUGE_LINE) or not any(marker in line for marker in (CODEX_FULL_MARKERS if full else CODEX_INDEX_MARKERS)):
        return None
    data = loads(line)
    if data is None:
        return None
    kind = data.get("type")
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    ptype = payload.get("type")
    record = {"timestamp": data.get("timestamp"), "type": kind}
    if kind == "session_meta":
        record["payload"] = top_level(payload, ("id", "timestamp", "cwd", "cli_version"))
        git = payload.get("git")
        if isinstance(git, dict):
            record["payload"]["git"] = top_level(git, ("branch",))
    elif kind == "turn_context":
        record["payload"] = top_level(payload, ("cwd",))
    elif kind == "event_msg" and ptype in ("user_message", "agent_message"):
        if ptype == "agent_message" and not full:
            return None
        record["payload"] = {"type": ptype, "message": text_of(payload.get("message"))[:TEXT_CHARS if full else PROMPT_CHARS]}
    elif full and kind == "response_item" and ptype in ("function_call", "custom_tool_call"):
        name = payload.get("name")
        record["payload"] = {"type": ptype, "name": name, "arguments": slim_arguments(payload.get("arguments"))}
        if name == "apply_patch" and isinstance(payload.get("input"), str):
            record["payload"]["input"] = payload["input"][:PATCH_CHARS]
    else:
        return None
    return record


def compact(records):
    kept, pending, context, titles = [], None, None, {}
    for record in records:
        if record.get("type") in TITLE_TYPES:
            titles[record["type"]] = record
            continue
        if record.get("isSidechain"):
            continue
        if "message" in record:
            if pending:
                kept.append(pending)
                pending = None
            kept.append(record)
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


class Budget:
    def __init__(self, limit):
        self.left = limit

    def spend(self, amount):
        self.left -= amount
        return self.left > 0


def scan(path, offset, reducer, budget=None):
    records, end, last = [], offset, None
    with open(path, "rb") as handle:
        if offset:
            handle.seek(offset - 1)
            if handle.read(1) != b"\n":
                offset = end = 0
        handle.seek(offset)
        for line in handle:
            if not line.endswith(b"\n"):
                break
            end += len(line)
            last = line
            record = reducer(line)
            if record is not None:
                records.append(record)
            if budget is not None and not budget.spend(len(line)):
                break
    return records, offset, end, last


def index_file(path, stat, known, reducer, budget):
    stamp = int(stat.st_mtime * 1000)
    if known and known.get("size") == stat.st_size and known.get("mtime") == stamp:
        return None
    start = known["offset"] if known and stat.st_size >= known.get("offset", 0) else 0
    records, start, end, last = scan(path, start, reducer, budget)
    size, mtime = (stat.st_size, stamp) if end >= stat.st_size else (end, 0)
    return {"path": path, "size": size, "mtime": mtime, "start": start, "end": end, "records": records, "last": last}


def index(request):
    offsets = request.get("offsets") or {}
    budget = Budget(request.get("budget") or INDEX_BUDGET)
    files, changes = [], []
    sources = [(path, "claude") for path in claude_files()] + [(path, "codex") for path in codex_files()]
    for path, kind in sources:
        try:
            stat = os.stat(path)
        except OSError:
            continue
        files.append(path)
        if budget.left <= 0:
            continue
        try:
            reducer = claude_index_record if kind == "claude" else (lambda line: codex_record(line, False))
            change = index_file(path, stat, offsets.get(path), reducer, budget)
        except Exception:
            continue
        if change is None:
            continue
        last = change.pop("last")
        if kind == "claude":
            change["records"] = compact(change["records"])
            change["projectKey"] = os.path.basename(os.path.dirname(path))
        else:
            change["projectKey"] = ""
            match = TIMESTAMP_RE.search(last[:400]) if last else None
            if match:
                stamp = match.group(1).decode("utf-8", "replace")
                change["records"].append({"timestamp": stamp, "type": "event_msg", "payload": {"type": "activity"}})
        changes.append(change)
    return {"files": files, "changes": changes, "live": live_sessions(), "shell": login_shell(), "more": budget.left <= 0}


def live_sessions():
    result = []
    for home in claude_homes():
        for path in glob.glob(os.path.join(home, "sessions", "*.json")):
            try:
                with open(path) as handle:
                    data = json.load(handle)
                pid, session_id = int(data.get("pid")), data.get("sessionId")
                if not isinstance(session_id, str):
                    continue
                with open("/proc/%d/cmdline" % pid, "rb") as handle:
                    if b"claude" not in handle.read():
                        continue
            except (OSError, ValueError, TypeError, AttributeError):
                continue
            entry = {k: data.get(k) if isinstance(data.get(k), str) else None for k in ("cwd", "status", "kind", "name")}
            entry.update({"pid": pid, "sessionId": session_id})
            if isinstance(data.get("startedAt"), int):
                entry["startedAt"] = data["startedAt"]
            result.append(entry)
    return result


def process_alive(pid):
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as handle:
            return bool(handle.read())
    except OSError:
        return False


def process_start(pid):
    try:
        with open("/proc/%d/stat" % pid) as handle:
            return handle.read().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def live_record(pid):
    for home in claude_homes():
        try:
            with open(os.path.join(home, "sessions", "%d.json" % pid)) as handle:
                return json.load(handle)
        except (OSError, ValueError):
            continue
    return None


def terminate(session_id, pid):
    pid = int(pid)
    record = live_record(pid)
    if not isinstance(record, dict) or not process_alive(pid):
        return {}
    if record.get("sessionId") != session_id:
        raise ValueError("PID %d is running a different session" % pid)
    if not record.get("procStart") or str(record["procStart"]) != process_start(pid):
        raise ValueError("Couldn't confirm PID %d is that Claude session, so it was left running" % pid)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return {}
    for _ in range(50):
        if not process_alive(pid):
            return {}
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    return {}


def login_shell():
    try:
        return pwd.getpwuid(os.getuid()).pw_shell or "/bin/bash"
    except KeyError:
        return os.environ.get("SHELL", "/bin/bash")


def login_env():
    shell = login_shell()
    out = subprocess.run([shell, "-lic", "exec env -0"], stdin=subprocess.DEVNULL, capture_output=True, timeout=15).stdout
    parts = out.split(b"\0")
    env = {}
    for index, part in enumerate(parts):
        if index == 0:
            part = part.rsplit(b"\n", 1)[-1]
        text = part.decode("utf-8", "replace")
        key, sep, value = text.partition("=")
        if sep and key and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            env[key] = value
    return {"shell": shell, "env": env}


def transcript(path, offset):
    session = resolve_session(path)
    reducer = (lambda line: codex_record(line, True)) if session["codex"] else claude_full_record
    records, start, end, _ = scan(session["path"], offset, reducer)
    return {"lines": records, "start": start, "end": end}


def task_record(line):
    if len(line) > TASK_LINE_LIMIT or not any(marker in line for marker in TASK_MARKERS):
        return None
    return loads(line)


def tasks(path, offset):
    session = resolve_session(path)
    if session["codex"]:
        return {"lines": [], "start": 0, "end": 0}
    records, start, end, _ = scan(session["path"], offset, task_record)
    return {"lines": records, "start": start, "end": end}


def delete(path):
    session = resolve_session(path)
    real = session["path"]
    os.remove(real)
    if not session["codex"]:
        home, session_id = session["home"], session["id"]
        for extra in (real[: -len(".jsonl")], os.path.join(home, "file-history", session_id), os.path.join(home, "session-env", session_id)):
            if os.path.isdir(extra) and not os.path.islink(extra):
                shutil.rmtree(extra, ignore_errors=True)
        try:
            os.rmdir(os.path.dirname(real))
        except OSError:
            pass
    return {"deleted": real}


def list_files(root):
    try:
        output = subprocess.run(
            GIT + ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
            capture_output=True, timeout=20, check=True,
        ).stdout.decode("utf-8", "replace")
        return {"files": [line for line in output.split("\0") if line][:MAX_LIST]}
    except (OSError, subprocess.SubprocessError):
        pass
    found = []
    for directory, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in NOISY_DIRS]
        for name in names:
            found.append(os.path.relpath(os.path.join(directory, name), root))
            if len(found) >= MAX_LIST:
                return {"files": found}
    return {"files": found}


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
    if before == after:
        return 0, 0
    old, new = before.splitlines(), after.splitlines()
    if len(old) + len(new) > EXACT_DIFF_LINES:
        from collections import Counter

        old_counts, new_counts = Counter(old), Counter(new)
        return sum((new_counts - old_counts).values()), sum((old_counts - new_counts).values())
    import difflib

    additions = deletions = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag in ("replace", "delete"):
            deletions += i2 - i1
        if tag in ("replace", "insert"):
            additions += j2 - j1
    return additions, deletions


def claude_changes(session):
    path, home, session_id = session["path"], session["home"], session["id"]
    backups = os.path.join(home, "file-history", session_id)
    cwd, tracked = "", {}
    with open(path, "rb") as handle:
        for line in handle:
            snapshot, tool = b'"file-history-snapshot"' in line, b'"tool_use"' in line
            if not (snapshot or tool or (not cwd and b'"cwd"' in line)):
                continue
            data = loads(line)
            if data is None:
                continue
            cwd = cwd or text_of(data.get("cwd"))
            if data.get("type") == "file-history-snapshot":
                backups_map = (data.get("snapshot") or {}).get("trackedFileBackups") if isinstance(data.get("snapshot"), dict) else None
                for target, backup in (backups_map or {}).items():
                    entry = tracked.setdefault(target, {"hash": None, "edits": 0})
                    name = backup.get("backupFileName") if isinstance(backup, dict) else None
                    if not entry["hash"] and isinstance(name, str):
                        entry["hash"] = name.split("@")[0]
            elif data.get("type") == "assistant" and isinstance(data.get("message"), dict):
                content = data["message"].get("content")
                for block in content if isinstance(content, list) else []:
                    if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") in EDIT_TOOLS:
                        tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
                        target = tool_input.get("file_path") or tool_input.get("notebook_path")
                        if isinstance(target, str) and target:
                            tracked.setdefault(target, {"hash": None, "edits": 0})["edits"] += 1
    merged = {}
    for target, info in tracked.items():
        absolute = os.path.normpath(target if os.path.isabs(target) or not cwd else os.path.join(cwd, target))
        entry = merged.setdefault(absolute, {"hash": None, "edits": 0})
        entry["edits"] += info["edits"]
        entry["hash"] = entry["hash"] or info["hash"]
    files = []
    for absolute, info in sorted(merged.items()):
        backup = "%s@v1" % info["hash"] if info["hash"] else None
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


def changes(path):
    session = resolve_session(path)
    if session["codex"]:
        return {"lines": scan(session["path"], 0, lambda line: codex_record(line, True))[0]}
    return claude_changes(session)


def exists(paths):
    return {"exists": [p for p in paths if isinstance(p, str) and os.path.isfile(p)]}


def backup(path, name):
    if not re.fullmatch(r"[0-9a-f]+@v\d+", name):
        raise ValueError("invalid backup name")
    session = resolve_session(path)
    text = read_text(os.path.join(session["home"], "file-history", session["id"], name))
    if text is None:
        raise ValueError("Backup not available")
    return {"text": text}


def git_status(root):
    top = subprocess.run(GIT + ["-C", root, "rev-parse", "--show-toplevel"], capture_output=True, check=True, timeout=15).stdout.decode("utf-8", "replace").strip()
    out = subprocess.run(GIT + ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], capture_output=True, check=True, timeout=15).stdout
    entries = [e for e in out.split(b"\0") if e]
    result, index = [], 0
    while index < len(entries):
        entry = entries[index]
        index += 1
        if len(entry) < 4:
            continue
        if entry[0:1] in (b"R", b"C") or entry[1:2] in (b"R", b"C"):
            index += 1
        code = entry[:2].decode("utf-8", "replace").strip() or "M"
        result.append({"path": os.path.join(top, entry[3:].decode("utf-8", "replace")), "code": code})
    return {"changes": result}


def git_head(path):
    directory, name = os.path.split(path)
    out = subprocess.run(GIT + ["-C", directory, "show", "HEAD:./%s" % name], capture_output=True, timeout=15)
    if out.returncode != 0:
        raise ValueError(out.stderr.decode("utf-8", "replace").strip() or "not in HEAD")
    return {"text": out.stdout.decode("utf-8", "replace")}


def rename(path, title):
    session = resolve_session(path)
    if session["codex"]:
        raise ValueError("Codex sessions are renamed inside Deck")
    title = title.strip()
    if not title:
        raise ValueError("Title can't be empty")
    real = session["path"]
    record = json.dumps({"type": "custom-title", "customTitle": title, "sessionId": session["id"]}, ensure_ascii=False)

    def complete():
        with open(real, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            if not handle.tell():
                return True
            handle.seek(-1, os.SEEK_END)
            return handle.read(1) == b"\n"

    done = complete()
    if not done:
        import time

        time.sleep(0.3)
        done = complete()
    with open(real, "a", encoding="utf-8") as handle:
        handle.write(("" if done else "\n") + record + "\n")
    return {"renamed": real}


def searchable_texts(record):
    if "payload" in record:
        payload = record["payload"]
        return [payload.get("message")] if payload.get("type") in ("user_message", "agent_message") else []
    content = record.get("message", {}).get("content")
    if isinstance(content, str):
        return [content]
    return [block.get("text") for block in content or [] if block.get("type") == "text"]


def search(request):
    needle = (request.get("prefilter") or "").encode("utf-8")
    query = request.get("query") or ""
    fold = bool(request.get("fold"))
    found = []
    if len(needle) < 2 or not query:
        return {"files": found}
    sources = [(path, False) for path in claude_files()] + [(path, True) for path in codex_files()]
    for path, codex in sources:
        lines = []
        try:
            with open(path, "rb") as handle:
                for line in handle:
                    if needle not in (line.lower() if fold else line):
                        continue
                    record = codex_record(line, True) if codex else claude_full_record(line)
                    if record is not None and any(isinstance(t, str) and query in t.lower() for t in searchable_texts(record)):
                        lines.append(record)
                        if len(lines) >= SEARCH_LINES_PER_FILE:
                            break
        except Exception:
            continue
        if lines:
            found.append({"path": path, "lines": lines})
    return {"files": found}


def emit(message):
    sys.stdout.buffer.write(json.dumps(message, ensure_ascii=False).encode("utf-8", "replace") + b"\n")
    sys.stdout.flush()


def watch(root):
    import ctypes
    import errno
    import select
    import struct
    import time

    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.inotify_init1(os.O_NONBLOCK | 0o2000000)
    if fd < 0:
        raise OSError(ctypes.get_errno(), "inotify is not available")
    mask = 0x2 | 0x8 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x1000000 | 0x2000000 | 0x4000000
    watches, warned = {}, [False]

    def noisy(path):
        return any(part in NOISY_DIRS for part in path.split("/")) or path.endswith(".claude-deck-tmp")

    def add(path):
        for directory, dirs, _ in os.walk(path):
            dirs[:] = [d for d in dirs if d not in NOISY_DIRS]
            wd = libc.inotify_add_watch(fd, os.fsencode(directory), mask)
            if wd < 0:
                if ctypes.get_errno() == errno.ENOSPC and not warned[0]:
                    warned[0] = True
                    emit({"warning": "inotify watch limit reached; some folders aren't watched"})
                continue
            watches[wd] = directory

    add(root)
    emit({"ready": True})
    pending, deadline, rescan = set(), None, False
    while True:
        timeout = max(0.0, deadline - time.monotonic()) if deadline else None
        readable = select.select([fd, 0], [], [], timeout)[0]
        if 0 in readable and not os.read(0, 4096):
            return
        if fd in readable:
            try:
                data = os.read(fd, 1 << 16)
            except BlockingIOError:
                data = b""
            offset = 0
            while offset + 16 <= len(data):
                wd, event, _, length = struct.unpack_from("iIII", data, offset)
                name = data[offset + 16: offset + 16 + length].rstrip(b"\0").decode("utf-8", "replace")
                offset += 16 + length
                if event & 0x4000:
                    rescan = True
                    continue
                directory = watches.get(wd)
                if event & 0x8000:
                    watches.pop(wd, None)
                    if not watches:
                        emit({"rescan": True})
                        return
                if directory is None:
                    continue
                path = os.path.join(directory, name) if name else directory
                if noisy(path):
                    continue
                if event & 0x40000000 and event & (0x100 | 0x80):
                    add(path)
                pending.add(path)
            if (pending or rescan) and deadline is None:
                deadline = time.monotonic() + 0.15
        if deadline is not None and time.monotonic() >= deadline:
            if rescan or len(pending) > 5000:
                emit({"rescan": True})
            else:
                emit({"paths": sorted(pending)})
            pending, deadline, rescan = set(), None, False


def read_stdin_json():
    text = sys.stdin.read()
    return json.loads(text) if text.strip() else {}


def main():
    mode, args = sys.argv[1], sys.argv[2:]
    handlers = {
        "index": lambda: index(read_stdin_json()),
        "transcript": lambda: transcript(args[0], int(args[1]) if len(args) > 1 else 0),
        "tasks": lambda: tasks(args[0], int(args[1]) if len(args) > 1 else 0),
        "delete": lambda: delete(args[0]),
        "terminate": lambda: terminate(args[0], args[1]),
        "files": lambda: list_files(args[0]),
        "changes": lambda: changes(args[0]),
        "exists": lambda: exists(read_stdin_json() or []),
        "backup": lambda: backup(args[0], args[1]),
        "git_status": lambda: git_status(args[0]),
        "git_head": lambda: git_head(args[0]),
        "search": lambda: search(read_stdin_json()),
        "rename": lambda: rename(args[0], sys.stdin.read()),
        "loginenv": login_env,
        "watch": lambda: watch(args[0]),
    }
    if mode not in handlers:
        raise ValueError("unknown mode %s" % mode)
    result = handlers[mode]()
    if result is not None:
        emit(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"error": str(error) or error.__class__.__name__})
        sys.exit(1)
