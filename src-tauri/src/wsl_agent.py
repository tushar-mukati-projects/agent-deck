from __future__ import annotations

import ctypes
import difflib
import glob
import json
import os
import pwd
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Callable, Iterator
from typing import Any

PROMPT_CHARS = 4000
TEXT_CHARS = 24001
TOOL_CHARS = 1000
PATCH_CHARS = 1000000
LONG_LINE = 64 * 1024
SNIFF_BYTES = 8192
EDGE_BYTES = 4000
ACTIVITY_SNIFF_BYTES = 400
HUGE_LINE = 16 * 1024 * 1024
API_MESSAGE_TYPE = b"message"
INDEX_BUDGET = 1024 * 1024 * 1024
SEARCH_LINES_PER_FILE = 20
MIN_SEARCH_BYTES = 2
MAX_LIST = 60000
SESSION_ID_CHARS = 36
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
ENV_KEY_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
BACKUP_NAME_RE = re.compile(r"[0-9a-f]+@v\d+")
GIT = ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false"]
GIT_TIMEOUT_S = 15
LIST_FILES_TIMEOUT_S = 20
LOGIN_TIMEOUT_S = 15
EXIT_POLLS = 50
EXIT_POLL_S = 0.1
PARTIAL_LINE_WAIT_S = 0.3
EDIT_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")
MAX_DIFF_BYTES = 2 * 1024 * 1024
EXACT_DIFF_LINES = 4000
NOISY_DIRS = (".git", "node_modules", "target", ".next", "__pycache__", ".venv")
TMP_SUFFIX = ".agent-deck-tmp"
EMPTY_LINES = {"lines": [], "start": 0, "end": 0}
TASK_LINE_LIMIT = 256 * 1024
TASK_MARKERS = (
    b'"run_in_background":true',
    b'"backgroundTaskId"',
    b"running in background with ID",
    b"<task-notification>",
    b'"name":"TaskStop"',
    b'"name":"KillShell"',
    b'"name":"Agent"',
    b'"name":"Task"',
    b'"name":"SendMessage"',
    b'"agentId"',
    b"Async agent launched",
)
AGENT_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
IN_CLOEXEC = 0o2000000
IN_MODIFY = 0x2
IN_CLOSE_WRITE = 0x8
IN_MOVED_FROM = 0x40
IN_MOVED_TO = 0x80
IN_CREATE = 0x100
IN_DELETE = 0x200
IN_DELETE_SELF = 0x400
IN_MOVE_SELF = 0x800
IN_Q_OVERFLOW = 0x4000
IN_IGNORED = 0x8000
IN_ONLYDIR = 0x1000000
IN_DONT_FOLLOW = 0x2000000
IN_EXCL_UNLINK = 0x4000000
IN_ISDIR = 0x40000000
WATCH_MASK = (
    IN_MODIFY | IN_CLOSE_WRITE | IN_MOVED_FROM | IN_MOVED_TO | IN_CREATE | IN_DELETE | IN_DELETE_SELF | IN_MOVE_SELF
    | IN_ONLYDIR | IN_DONT_FOLLOW | IN_EXCL_UNLINK
)
EVENT_FORMAT = "iIII"
EVENT_BYTES = struct.calcsize(EVENT_FORMAT)
STDIN_READ_BYTES = 4096
INOTIFY_READ_BYTES = 1 << 16
WATCH_DEBOUNCE_S = 0.15
MAX_WATCH_PATHS = 5000


def homes(variable: str, name: str, marker: str) -> list[str]:
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


def claude_homes() -> list[str]:
    return homes("CLAUDE_CONFIG_DIR", ".claude", "projects")


def codex_homes() -> list[str]:
    return homes("CODEX_HOME", ".codex", "sessions")


def real_folder(home: str, name: str) -> str:
    return os.path.realpath(os.path.join(home, name))


def real_files(folder: str, depth: int, prefix: str) -> Iterator[str]:
    try:
        with os.scandir(folder) as scanned:
            entries = [entry for entry in scanned if not entry.is_symlink()]
    except OSError:
        return
    for entry in entries:
        if depth and entry.is_dir():
            yield from real_files(entry.path, depth - 1, prefix)
        elif not depth and entry.is_file() and entry.name.startswith(prefix) and entry.name.endswith(".jsonl"):
            yield entry.path


def claude_files() -> Iterator[str]:
    for home in claude_homes():
        yield from real_files(real_folder(home, "projects"), 1, "")


def codex_files() -> Iterator[str]:
    for home in codex_homes():
        yield from real_files(real_folder(home, "sessions"), 3, "rollout-")


def session_sources() -> list[tuple[str, bool]]:
    return [(path, False) for path in claude_files()] + [(path, True) for path in codex_files()]


def resolve_session(path: str) -> dict[str, Any]:
    real = os.path.realpath(path)
    name = os.path.basename(real)
    if not real.endswith(".jsonl"):
        raise ValueError("not a session file")
    stem = name[: -len(".jsonl")]
    for home in codex_homes():
        root = real_folder(home, "sessions") + os.sep
        if real.startswith(root) and name.startswith("rollout-") and SESSION_ID_RE.fullmatch(stem[-SESSION_ID_CHARS:]):
            return {"path": real, "codex": True, "home": home, "id": stem[-SESSION_ID_CHARS:]}
    for home in claude_homes():
        if os.path.dirname(os.path.dirname(real)) == real_folder(home, "projects") and SESSION_ID_RE.fullmatch(stem):
            return {"path": real, "codex": False, "home": home, "id": stem}
    raise ValueError("not a session file")


def text_of(value: object) -> str:
    return value if isinstance(value, str) else ""


def has_tool_result(content: object) -> bool:
    return isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def slim_input(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {k: value[k][:TOOL_CHARS] for k in TOOL_FIELDS if isinstance(value.get(k), str)}


def slim_content(content: object, limit: int, assistant: bool) -> str | list[dict[str, Any]] | None:
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


def top_level(data: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {k: data[k] for k in keys if k in data}


def outer_type(first: bytes, tail: bytes) -> bytes:
    if first != API_MESSAGE_TYPE:
        return first
    kinds = HUGE_FIELDS["type"].findall(tail)
    return kinds[-1] if kinds else b""


def huge_record(line: bytes) -> dict[str, Any] | None:
    head, tail = line[:EDGE_BYTES], line[-EDGE_BYTES:]
    record = {}
    for key, pattern in HUGE_FIELDS.items():
        match = pattern.search(head) or pattern.search(tail)
        if match:
            value = outer_type(match.group(1), tail) if key == "type" else match.group(1)
            try:
                record[key] = json.loads(b'"' + value + b'"')
            except ValueError:
                pass
    for key, pattern in FLAG_FIELDS.items():
        match = pattern.search(head) or pattern.search(tail)
        record[key] = bool(match and match.group(1) == b"true")
    return record if record.get("type") in ("user", "assistant") else None


def loads(line: bytes) -> dict[str, Any] | None:
    try:
        data = json.loads(line)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def is_bulky(line: bytes) -> bool:
    if len(line) > HUGE_LINE:
        return True
    if len(line) <= LONG_LINE:
        return False
    head = line[:SNIFF_BYTES]
    match = HUGE_FIELDS["type"].search(head)
    kind = outer_type(match.group(1), line[-EDGE_BYTES:]) if match else b""
    return kind == b"assistant" or (kind == b"user" and b'"tool_result"' in head)


def claude_index_record(line: bytes) -> dict[str, Any] | None:
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


def claude_full_record(line: bytes, sidechain: bool = False) -> dict[str, Any] | None:
    if b'"type":"user"' not in line and b'"type":"assistant"' not in line:
        return None
    data = loads(line)
    if data is None or data.get("type") not in ("user", "assistant") or (data.get("isSidechain") and not sidechain):
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


def slim_arguments(arguments: object) -> str | None:
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


def codex_record(line: bytes, full: bool) -> dict[str, Any] | None:
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


def codex_full_record(line: bytes) -> dict[str, Any] | None:
    return codex_record(line, True)


def compact(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
    def __init__(self, limit: int) -> None:
        self.left = limit

    def spend(self, amount: int) -> bool:
        self.left -= amount
        return self.left > 0


def scan(
    path: str, offset: int, reducer: Callable[[bytes], dict[str, Any] | None], budget: Budget | None = None
) -> tuple[list[dict[str, Any]], int, int, bytes | None]:
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


def lines_from(path: str, offset: int, reducer: Callable[[bytes], dict[str, Any] | None]) -> dict[str, Any]:
    records, start, end, _ = scan(path, offset, reducer)
    return {"lines": records, "start": start, "end": end}


def index_file(
    path: str, stat: os.stat_result, known: dict[str, int] | None, reducer: Callable[[bytes], dict[str, Any] | None], budget: Budget
) -> dict[str, Any] | None:
    stamp = int(stat.st_mtime * 1000)
    if known and known["size"] == stat.st_size and known["mtime"] == stamp:
        return None
    start = known["offset"] if known and stat.st_size >= known["offset"] else 0
    records, start, end, last = scan(path, start, reducer, budget)
    size, mtime = (stat.st_size, stamp) if end >= stat.st_size else (end, 0)
    return {"path": path, "size": size, "mtime": mtime, "start": start, "end": end, "records": records, "last": last}


def index(request: dict[str, Any]) -> dict[str, Any]:
    offsets = request["offsets"]
    budget = Budget(INDEX_BUDGET)
    files, updated = [], []
    for path, codex in session_sources():
        try:
            stat = os.stat(path)
        except OSError:
            continue
        files.append(path)
        if budget.left <= 0:
            continue
        try:
            reducer = (lambda line: codex_record(line, False)) if codex else claude_index_record
            change = index_file(path, stat, offsets.get(path), reducer, budget)
        except Exception:
            continue
        if change is None:
            continue
        last = change.pop("last")
        if codex:
            change["projectKey"] = ""
            match = TIMESTAMP_RE.search(last[:ACTIVITY_SNIFF_BYTES]) if last else None
            if match:
                stamp = match.group(1).decode("utf-8", "replace")
                change["records"].append({"timestamp": stamp, "type": "event_msg", "payload": {"type": "activity"}})
        else:
            change["records"] = compact(change["records"])
            change["projectKey"] = os.path.basename(os.path.dirname(path))
        updated.append(change)
    return {"files": files, "changes": updated, "live": live_sessions(), "shell": login_shell(), "more": budget.left <= 0}


def read_json(path: str) -> Any:
    with open(path, "rb") as handle:
        return json.load(handle)


def cmdline(pid: int) -> bytes:
    with open("/proc/%d/cmdline" % pid, "rb") as handle:
        return handle.read()


def live_sessions() -> list[dict[str, Any]]:
    result = []
    for home in claude_homes():
        for path in glob.glob(os.path.join(home, "sessions", "*.json")):
            try:
                data = read_json(path)
                pid, session_id = int(data.get("pid")), data.get("sessionId")
                if not isinstance(session_id, str) or b"claude" not in cmdline(pid):
                    continue
            except (OSError, ValueError, TypeError, AttributeError):
                continue
            entry = {"status": data.get("status") if isinstance(data.get("status"), str) else None, "pid": pid, "sessionId": session_id}
            if isinstance(data.get("startedAt"), int):
                entry["startedAt"] = data["startedAt"]
            result.append(entry)
    return result


def process_alive(pid: int) -> bool:
    try:
        return bool(cmdline(pid))
    except OSError:
        return False


def process_start(pid: int) -> str | None:
    try:
        with open("/proc/%d/stat" % pid) as handle:
            return handle.read().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def live_record(pid: int) -> Any:
    for home in claude_homes():
        try:
            return read_json(os.path.join(home, "sessions", "%d.json" % pid))
        except (OSError, ValueError):
            continue
    return None


def terminate(session_id: str, pid_text: str) -> dict[str, Any]:
    pid = int(pid_text)
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
    for _ in range(EXIT_POLLS):
        if not process_alive(pid):
            return {}
        time.sleep(EXIT_POLL_S)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    return {}


def login_shell() -> str:
    try:
        return pwd.getpwuid(os.getuid()).pw_shell or "/bin/bash"
    except KeyError:
        return os.environ.get("SHELL", "/bin/bash")


def login_env() -> dict[str, Any]:
    shell = login_shell()
    out = subprocess.run([shell, "-lic", "exec env -0"], stdin=subprocess.DEVNULL, capture_output=True, timeout=LOGIN_TIMEOUT_S).stdout
    env = {}
    for position, part in enumerate(out.split(b"\0")):
        if position == 0:
            part = part.rsplit(b"\n", 1)[-1]
        key, sep, value = part.decode("utf-8", "replace").partition("=")
        if sep and key and ENV_KEY_RE.fullmatch(key):
            env[key] = value
    return {"shell": shell, "env": env}


def transcript(path: str, offset: int) -> dict[str, Any]:
    session = resolve_session(path)
    return lines_from(session["path"], offset, codex_full_record if session["codex"] else claude_full_record)


def subagent_file(folder: str, key: str) -> str | None:
    direct = os.path.join(folder, "agent-" + key + ".jsonl")
    if os.path.isfile(direct):
        return direct
    try:
        names = os.listdir(folder)
    except OSError:
        return None
    for name in names:
        if not name.endswith(".meta.json"):
            continue
        try:
            meta = read_json(os.path.join(folder, name))
        except (OSError, ValueError):
            continue
        real = os.path.join(folder, name[: -len(".meta.json")] + ".jsonl")
        if isinstance(meta, dict) and meta.get("toolUseId") == key and os.path.isfile(real):
            return real
    return None


def subagent(path: str, key: str, offset: int) -> dict[str, Any]:
    session = resolve_session(path)
    if session["codex"] or not AGENT_ID_RE.fullmatch(key):
        raise ValueError("not a subagent")
    real = subagent_file(os.path.join(session["path"][: -len(".jsonl")], "subagents"), key)
    if not real:
        return EMPTY_LINES
    return lines_from(real, offset, lambda line: claude_full_record(line, True))


def task_record(line: bytes) -> dict[str, Any] | None:
    if len(line) > TASK_LINE_LIMIT or not any(marker in line for marker in TASK_MARKERS):
        return None
    return loads(line)


def tasks(path: str, offset: int) -> dict[str, Any]:
    session = resolve_session(path)
    if session["codex"]:
        return EMPTY_LINES
    return lines_from(session["path"], offset, task_record)


def delete(path: str) -> dict[str, str]:
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


def run_git(directory: str, args: list[str], timeout: float = GIT_TIMEOUT_S) -> bytes:
    return subprocess.run(GIT + ["-C", directory] + args, capture_output=True, check=True, timeout=timeout).stdout


def quiet_walk(root: str) -> Iterator[tuple[str, list[str]]]:
    for directory, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in NOISY_DIRS]
        yield directory, names


def list_files(root: str) -> dict[str, list[str]]:
    try:
        output = run_git(root, ["ls-files", "-co", "--exclude-standard", "-z"], LIST_FILES_TIMEOUT_S).decode("utf-8", "replace")
        return {"files": [line for line in output.split("\0") if line][:MAX_LIST]}
    except (OSError, subprocess.SubprocessError):
        pass
    found = []
    for directory, names in quiet_walk(root):
        for name in names:
            found.append(os.path.relpath(os.path.join(directory, name), root))
            if len(found) >= MAX_LIST:
                return {"files": found}
    return {"files": found}


def read_text(path: str) -> str | None:
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > MAX_DIFF_BYTES:
            return None
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError:
        return None
    return None if b"\0" in data[:SNIFF_BYTES] else data.decode("utf-8", "replace")


def line_stats(before: str, after: str) -> tuple[int, int]:
    if before == after:
        return 0, 0
    old, new = before.splitlines(), after.splitlines()
    if len(old) + len(new) > EXACT_DIFF_LINES:
        old_counts, new_counts = Counter(old), Counter(new)
        return sum((new_counts - old_counts).values()), sum((old_counts - new_counts).values())
    additions = deletions = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag in ("replace", "delete"):
            deletions += i2 - i1
        if tag in ("replace", "insert"):
            additions += j2 - j1
    return additions, deletions


def note_snapshot(snapshot: object, tracked: dict[str, str | None]) -> None:
    backups = snapshot.get("trackedFileBackups") if isinstance(snapshot, dict) else None
    if not isinstance(backups, dict):
        return
    for target, saved in backups.items():
        name = saved.get("backupFileName") if isinstance(saved, dict) else None
        tracked.setdefault(target, None)
        if not tracked[target] and isinstance(name, str):
            tracked[target] = name.split("@")[0]


def note_edits(content: object, tracked: dict[str, str | None]) -> None:
    for block in content if isinstance(content, list) else []:
        if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") in EDIT_TOOLS:
            tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
            target = tool_input.get("file_path") or tool_input.get("notebook_path")
            if isinstance(target, str) and target:
                tracked.setdefault(target, None)


def tracked_files(path: str) -> tuple[str, dict[str, str | None]]:
    cwd, tracked = "", {}
    with open(path, "rb") as handle:
        for line in handle:
            if not (b'"file-history-snapshot"' in line or b'"tool_use"' in line or (not cwd and b'"cwd"' in line)):
                continue
            data = loads(line)
            if data is None:
                continue
            cwd = cwd or text_of(data.get("cwd"))
            if data.get("type") == "file-history-snapshot":
                note_snapshot(data.get("snapshot"), tracked)
            elif data.get("type") == "assistant" and isinstance(data.get("message"), dict):
                note_edits(data["message"].get("content"), tracked)
    return cwd, tracked


def absolute_targets(tracked: dict[str, str | None], cwd: str) -> dict[str, str | None]:
    merged = {}
    for target, saved_hash in tracked.items():
        absolute = os.path.normpath(target if os.path.isabs(target) or not cwd else os.path.join(cwd, target))
        merged[absolute] = merged.get(absolute) or saved_hash
    return merged


def changed_file(absolute: str, saved_hash: str | None, backups: str) -> dict[str, Any] | None:
    saved = "%s@v1" % saved_hash if saved_hash else None
    if saved and not os.path.isfile(os.path.join(backups, saved)):
        saved = None
    present = os.path.isfile(absolute)
    if not saved and not present:
        return None
    before = read_text(os.path.join(backups, saved)) if saved else None
    after = read_text(absolute) if present else None
    if not saved:
        status = "added"
    elif not present:
        status = "deleted"
    else:
        status = "unchanged" if before is not None and before == after else "modified"
    additions, deletions = line_stats(before or "", after or "")
    return {"path": absolute, "status": status, "additions": additions, "deletions": deletions, "backup": saved}


def claude_changes(session: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    backups = os.path.join(session["home"], "file-history", session["id"])
    cwd, tracked = tracked_files(session["path"])
    found = (changed_file(absolute, saved_hash, backups) for absolute, saved_hash in sorted(absolute_targets(tracked, cwd).items()))
    return {"files": [entry for entry in found if entry is not None]}


def changes(path: str) -> dict[str, Any]:
    session = resolve_session(path)
    if session["codex"]:
        return {"lines": scan(session["path"], 0, codex_full_record)[0]}
    return claude_changes(session)


def exists(paths: list[str]) -> dict[str, list[str]]:
    return {"exists": [p for p in paths if os.path.isfile(p)]}


def backup(path: str, name: str) -> dict[str, str]:
    if not BACKUP_NAME_RE.fullmatch(name):
        raise ValueError("invalid backup name")
    session = resolve_session(path)
    text = read_text(os.path.join(session["home"], "file-history", session["id"], name))
    if text is None:
        raise ValueError("Backup not available")
    return {"text": text}


def git_status(root: str) -> dict[str, list[dict[str, str]]]:
    top = run_git(root, ["rev-parse", "--show-toplevel"]).decode("utf-8", "replace").strip()
    out = run_git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    entries = [e for e in out.split(b"\0") if e]
    result, position = [], 0
    while position < len(entries):
        entry = entries[position]
        position += 1
        if len(entry) < 4:
            continue
        if entry[0:1] in (b"R", b"C") or entry[1:2] in (b"R", b"C"):
            position += 1
        code = entry[:2].decode("utf-8", "replace").strip() or "M"
        result.append({"path": os.path.join(top, entry[3:].decode("utf-8", "replace")), "code": code})
    return {"changes": result}


def git_head(path: str) -> dict[str, str]:
    directory, name = os.path.split(path)
    try:
        out = run_git(directory, ["show", "HEAD:./%s" % name])
    except subprocess.CalledProcessError as error:
        raise ValueError(error.stderr.decode("utf-8", "replace").strip() or "not in HEAD") from error
    return {"text": out.decode("utf-8", "replace")}


def rename(path: str, title: str) -> dict[str, str]:
    session = resolve_session(path)
    if session["codex"]:
        raise ValueError("Codex sessions are renamed inside Deck")
    title = title.strip()
    if not title:
        raise ValueError("Title can't be empty")
    real = session["path"]
    record = json.dumps({"type": "custom-title", "customTitle": title, "sessionId": session["id"]}, ensure_ascii=False)

    def complete() -> bool:
        with open(real, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            if not handle.tell():
                return True
            handle.seek(-1, os.SEEK_END)
            return handle.read(1) == b"\n"

    done = complete()
    if not done:
        time.sleep(PARTIAL_LINE_WAIT_S)
        done = complete()
    with open(real, "a", encoding="utf-8") as handle:
        handle.write(("" if done else "\n") + record + "\n")
    return {"renamed": real}


def searchable_texts(record: dict[str, Any]) -> list[object]:
    if "payload" in record:
        payload = record["payload"]
        return [payload.get("message")] if payload.get("type") in ("user_message", "agent_message") else []
    content = record["message"]["content"]
    if isinstance(content, str):
        return [content]
    return [block.get("text") for block in content if block.get("type") == "text"]


def search(request: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    needle = request["prefilter"].encode("utf-8")
    query = request["query"]
    fold = request["fold"]
    found = []
    if len(needle) < MIN_SEARCH_BYTES or not query:
        return {"files": found}
    for path, codex in session_sources():
        lines = []
        try:
            with open(path, "rb") as handle:
                for line in handle:
                    if needle not in (line.lower() if fold else line):
                        continue
                    record = codex_full_record(line) if codex else claude_full_record(line)
                    if record is not None and any(isinstance(t, str) and query in t.lower() for t in searchable_texts(record)):
                        lines.append(record)
                        if len(lines) >= SEARCH_LINES_PER_FILE:
                            break
        except Exception:
            pass
        if lines:
            found.append({"path": path, "lines": lines})
    return {"files": found}


def emit(message: dict[str, Any]) -> None:
    sys.stdout.buffer.write(json.dumps(message, ensure_ascii=False).encode("utf-8", "replace") + b"\n")
    sys.stdout.flush()


def noisy(root: str, path: str) -> bool:
    return any(part in NOISY_DIRS for part in os.path.relpath(path, root).split(os.sep)) or path.endswith(TMP_SUFFIX)


class Watcher:
    def __init__(self, root: str) -> None:
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.fd = self.libc.inotify_init1(os.O_NONBLOCK | IN_CLOEXEC)
        if self.fd < 0:
            raise OSError(ctypes.get_errno(), "inotify is not available")
        self.root = root
        self.watches: dict[int, str] = {}
        self.pending: set[str] = set()
        self.rescan = False

    def add(self, path: str) -> None:
        for directory, _ in quiet_walk(path):
            wd = self.libc.inotify_add_watch(self.fd, os.fsencode(directory), WATCH_MASK)
            if wd >= 0:
                self.watches[wd] = directory

    def read(self) -> bool:
        try:
            data = os.read(self.fd, INOTIFY_READ_BYTES)
        except BlockingIOError:
            data = b""
        offset = 0
        while offset + EVENT_BYTES <= len(data):
            wd, event, _, length = struct.unpack_from(EVENT_FORMAT, data, offset)
            name = data[offset + EVENT_BYTES: offset + EVENT_BYTES + length].rstrip(b"\0").decode("utf-8", "replace")
            offset += EVENT_BYTES + length
            if not self.note(wd, event, name):
                return False
        return True

    def note(self, wd: int, event: int, name: str) -> bool:
        if event & IN_Q_OVERFLOW:
            self.rescan = True
            return True
        directory = self.watches.get(wd)
        if event & IN_IGNORED:
            self.watches.pop(wd, None)
            if not self.watches:
                return False
        if directory is None:
            return True
        path = os.path.join(directory, name) if name else directory
        if noisy(self.root, path):
            return True
        if event & IN_ISDIR and event & (IN_CREATE | IN_MOVED_TO):
            self.add(path)
        self.pending.add(path)
        return True

    def flush(self) -> None:
        if self.rescan or len(self.pending) > MAX_WATCH_PATHS:
            emit({"rescan": True})
        else:
            emit({"paths": sorted(self.pending)})
        self.pending, self.rescan = set(), False


def watch(root: str) -> None:
    watcher = Watcher(root)
    watcher.add(root)
    emit({"ready": True})
    deadline = None
    while True:
        timeout = max(0.0, deadline - time.monotonic()) if deadline else None
        readable = select.select([watcher.fd, 0], [], [], timeout)[0]
        if 0 in readable and not os.read(0, STDIN_READ_BYTES):
            return
        if watcher.fd in readable:
            if not watcher.read():
                emit({"rescan": True})
                return
            if (watcher.pending or watcher.rescan) and deadline is None:
                deadline = time.monotonic() + WATCH_DEBOUNCE_S
        if deadline is not None and time.monotonic() >= deadline:
            watcher.flush()
            deadline = None


def read_stdin_json() -> Any:
    return json.loads(sys.stdin.read())


def main() -> None:
    mode, args = sys.argv[1], sys.argv[2:]
    handlers = {
        "index": lambda: index(read_stdin_json()),
        "transcript": lambda: transcript(args[0], int(args[1])),
        "tasks": lambda: tasks(args[0], int(args[1])),
        "subagent": lambda: subagent(args[0], args[1], int(args[2])),
        "delete": lambda: delete(args[0]),
        "terminate": lambda: terminate(args[0], args[1]),
        "files": lambda: list_files(args[0]),
        "changes": lambda: changes(args[0]),
        "exists": lambda: exists(read_stdin_json()),
        "backup": lambda: backup(args[0], args[1]),
        "git_status": lambda: git_status(args[0]),
        "git_head": lambda: git_head(args[0]),
        "search": lambda: search(read_stdin_json()),
        "rename": lambda: rename(args[0], sys.stdin.read()),
        "loginenv": login_env,
        "watch": lambda: watch(args[0]),
    }
    result = handlers[mode]()
    if result is not None:
        emit(result)


try:
    main()
except Exception as error:
    emit({"error": str(error) or error.__class__.__name__})
    sys.exit(1)
