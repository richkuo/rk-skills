import argparse
import fnmatch
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile

HEADING = "\x23\x23 Agent guide contract"
LABELS = ("Generated", "Sources", "Regenerate", "Verify", "Command files")
LINE_RE = re.compile(r"^- (Generated|Sources|Regenerate|Verify|Command files): (.+)$")
SPANS_RE = re.compile(r"^`([^`]+)`(?:, `([^`]+)`)*$")
SPAN_RE = re.compile(r"`([^`]+)`")
PATH_RE = re.compile(r"^[A-Za-z0-9._/*-]+$")
COMMAND_RE = re.compile(r"^[A-Za-z0-9._/=:@%+-]+(?: [A-Za-z0-9._/=:@%+-]+)*$")
HEADING_RE = re.compile(r"^ {0,3}\x23{1,6}(?:[ \t]|$)")
FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
FENCE_CLOSE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*$")
BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@+-]*$")
SLUG_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
SHA_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
SAFE_ARG_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
COMMAND_TIMEOUT = 600
OUTPUT_LIMIT = 60000
GIT_SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"]
MESSAGE_FILE = ".rk-guide-commit-message.txt"
WORK_BRANCH = "rk-guide/revise"
FOOTER_RE = re.compile(r"^(?:(?:Created|Updated) with LLM: |LLM: )", re.MULTILINE)
LOCAL_EXEC_KEY_RE = re.compile(r"^(?:filter\..*|diff\.external|diff\..*\.(?:textconv|command)|merge\..*\.driver|core\.(?:fsmonitor|hookspath|pager|editor|attributesfile|excludesfile|worktree|bare)|gpg\..*|commit\.gpgsign|user\.signingkey|sequence\.editor|extensions\..*|include\..*|includeif\..*)$")
NETWORK_KEY_RE = re.compile(r"^(?:credential\..*|url\..*|http\..*|protocol\..*|remote\..*|core\.(?:sshcommand|askpass|gitproxy)|push\..*|branch\..*)$")


class Stop(Exception):
    def __init__(self, reason, command="", exit_code=None, output=""):
        super().__init__(reason)
        self.reason = reason
        self.command = command
        self.exit_code = exit_code
        self.output = output


def one_line(text):
    return " ".join(str(text).split())


def git(repo, *args, check=True, data=None, env=None):
    proc = subprocess.run(
        ["git", "-C", repo, *GIT_SAFE, *args],
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    if check and proc.returncode != 0:
        raise Stop(f"git {' '.join(args)} failed: {one_line(proc.stderr.decode('utf-8', 'replace'))}")
    return proc


def git_text(repo, *args, check=True):
    return git(repo, *args, check=check).stdout.decode("utf-8", "replace")


def object_format(repo):
    proc = git(repo, "rev-parse", "--show-object-format", check=False)
    value = proc.stdout.decode().strip() if proc.returncode == 0 else ""
    return "sha256" if value == "sha256" else "sha1"


def blob_id(data, algo):
    digest = hashlib.new(algo)
    digest.update(b"blob %d\0" % len(data))
    digest.update(data)
    return digest.hexdigest()


def tree_entries(repo, rev):
    out = git(repo, "ls-tree", "-r", "-z", "--full-tree", rev).stdout.decode("utf-8", "surrogateescape")
    entries = {}
    for record in out.split("\0"):
        if not record:
            continue
        meta, path = record.split("\t", 1)
        mode, kind, oid = meta.split(" ")
        entries[path] = (mode, kind, oid)
    return entries


def read_blob(repo, oid):
    return git(repo, "cat-file", "blob", oid).stdout


def split_lines(text):
    return text.split("\n")


def contract_lines(text):
    lines = split_lines(text)
    fence = None
    starts = []
    headings = []
    for index, line in enumerate(lines):
        if fence is not None:
            close = FENCE_CLOSE_RE.match(line)
            if close and close.group(1)[0] == fence[0] and len(close.group(1)) >= len(fence):
                fence = None
            continue
        opening = FENCE_OPEN_RE.match(line)
        if opening and not (opening.group(1)[0] == "`" and "`" in opening.group(2)):
            fence = opening.group(1)
            continue
        if HEADING_RE.match(line):
            headings.append(index)
            if line == HEADING:
                starts.append(index)
    if not starts:
        return None, None
    if len(starts) > 1:
        return None, "the contract heading appears more than once"
    start = starts[0]
    later = [h for h in headings if h > start]
    end = later[0] if later else len(lines)
    block = lines[start:end]
    while block and not block[-1].strip():
        block.pop()
    return block, None


def validate_path(value, label):
    if not PATH_RE.match(value):
        raise ValueError(f"{label} path {value!r} holds a character outside A-Z a-z 0-9 . _ / * -")
    directory = value.endswith("/")
    if directory and label != "Command files":
        raise ValueError(f"{label} path {value!r} ends with a slash, which only Command files accepts")
    body = value[:-1] if directory else value
    if not body or body.startswith("/"):
        raise ValueError(f"{label} path {value!r} is empty or starts with a slash")
    for segment in body.split("/"):
        if segment in ("", ".", ".."):
            raise ValueError(f"{label} path {value!r} holds an empty, . or .. segment")
        if segment.lower() == ".git":
            raise ValueError(f"{label} path {value!r} names a .git segment")
    if "*" in value and (label == "Generated" or directory):
        raise ValueError(f"{label} path {value!r} holds a * where only literal paths are accepted")
    return value


def parse_contract(text):
    block, error = contract_lines(text)
    if error:
        return "malformed", error, None
    if block is None:
        return "none", "the root CLAUDE.md has no contract heading outside a code fence", None
    values = {}
    for number, line in enumerate(block[1:], start=2):
        if not line.strip():
            continue
        match = LINE_RE.match(line)
        if not match:
            return "malformed", f"line {number} of the contract block is not one of the five labels", None
        label, value = match.group(1), match.group(2)
        if label in values:
            return "malformed", f"the contract block states {label} more than once", None
        if not SPANS_RE.match(value):
            return "malformed", f"the {label} value is not backtick spans joined by a comma and a space", None
        values[label] = SPAN_RE.findall(value)
    missing = [label for label in LABELS if label not in values]
    if missing:
        return "malformed", f"the contract block does not state {', '.join(missing)}", None
    try:
        for label in ("Regenerate", "Verify"):
            if len(values[label]) != 1:
                raise ValueError(f"{label} takes one command")
            if not COMMAND_RE.match(values[label][0]):
                raise ValueError(f"the {label} command holds a character outside A-Z a-z 0-9 space . _ / = : @ % + - or a double space")
        for label in ("Generated", "Sources", "Command files"):
            for value in values[label]:
                validate_path(value, label)
            if len(set(values[label])) != len(values[label]):
                raise ValueError(f"{label} names a path twice")
        if "CLAUDE.md" in values["Generated"]:
            raise ValueError("Generated names CLAUDE.md, which holds the contract")
        for generated in values["Generated"]:
            for label in ("Sources", "Command files"):
                if any(match_path(pattern, generated) for pattern in values[label]):
                    raise ValueError(f"the generated path {generated} matches a {label} entry")
    except ValueError as error:
        return "malformed", str(error), None
    contract = {
        "generated": values["Generated"],
        "sources": values["Sources"],
        "regenerate": values["Regenerate"][0],
        "verify": values["Verify"][0],
        "command_files": values["Command files"],
        "block": "\n".join(block),
    }
    return "ok", "", contract


def match_path(pattern, path):
    if pattern.endswith("/"):
        return path.startswith(pattern)
    parts = pattern.split("/")
    segments = path.split("/")
    if len(parts) != len(segments):
        return False
    return all(fnmatch.fnmatchcase(segment, part) for part, segment in zip(parts, segments))


def matches_any(patterns, path):
    return any(match_path(pattern, path) for pattern in patterns)


def trusted_contract(repo, ref):
    entries = tree_entries(repo, ref)
    entry = entries.get("CLAUDE.md")
    if entry is None or entry[1] != "blob" or entry[0] not in ("100644", "100755"):
        return "none", "the default branch has no regular CLAUDE.md file", None, entries
    text = read_blob(repo, entry[2]).decode("utf-8", "replace")
    state, reason, contract = parse_contract(text)
    if state == "ok":
        overlap = [path for path in entries if matches_any(contract["sources"], path) and matches_any(contract["command_files"], path)]
        if overlap:
            return "malformed", f"the path {overlap[0]} matches both a Sources entry and a Command files entry", None, entries
        listed = [path for path in entries if matches_any(contract["command_files"], path)]
        if not listed:
            return "malformed", "no file on the default branch matches the Command files entries", None, entries
    return state, reason, contract, entries


def permit_entries(contract):
    return [f"Bash({contract['regenerate']})", f"Bash({contract['verify']})"]


def split_extra(extra):
    return [entry.strip() for entry in extra.split(",") if entry.strip()]


def permit_list(permit):
    return [entry for entry in split_extra(permit) if COMMAND_RE.match(entry)]


def permit_state(contract, permit):
    entries = permit_list(permit)
    for label, command in (("regenerate", contract["regenerate"]), ("verify", contract["verify"])):
        if command not in entries:
            return False, f"the caller workflow does not permit the {label} command {command}: add the exact command {command} to the guide_contract_permit input"
    return True, ""


def filtered_extra(contract, extra):
    drop = set(permit_entries(contract)) if contract else set()
    return ",".join(entry for entry in split_extra(extra) if entry not in drop)


def static_prefix(pattern):
    body = pattern[:-1] if pattern.endswith("/") else pattern
    parts = body.split("/")
    prefix = []
    for part in parts:
        if "*" in part:
            break
        prefix.append(part)
    if pattern.endswith("/") or len(prefix) < len(parts):
        return "/".join(prefix), True
    return "/".join(prefix), False


def disk_entry(full, algo):
    try:
        info = os.lstat(full)
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(info.st_mode):
        return ("120000", blob_id(os.fsencode(os.readlink(full)), algo))
    if stat.S_ISREG(info.st_mode):
        with open(full, "rb") as handle:
            data = handle.read()
        mode = "100755" if info.st_mode & stat.S_IXUSR else "100644"
        return (mode, blob_id(data, algo))
    return ("other", "")


def disk_files(repo, patterns, algo):
    found = {}
    for pattern in patterns:
        prefix, walk = static_prefix(pattern)
        if not walk:
            entry = disk_entry(os.path.join(repo, prefix), algo)
            if entry is not None:
                found[prefix] = entry
            continue
        top = os.path.join(repo, prefix) if prefix else repo
        if not os.path.isdir(top) or os.path.islink(top):
            if prefix and os.path.lexists(top) and matches_any([pattern], prefix):
                found[prefix] = disk_entry(top, algo)
            continue
        for current, dirs, files in os.walk(top):
            rel_dir = os.path.relpath(current, repo)
            rel_dir = "" if rel_dir == "." else rel_dir
            dirs[:] = [d for d in dirs if d != ".git"]
            names = list(files) + [d for d in dirs if os.path.islink(os.path.join(current, d))]
            for name in names:
                if name == ".git":
                    continue
                rel = f"{rel_dir}/{name}" if rel_dir else name
                if match_path(pattern, rel):
                    found[rel] = disk_entry(os.path.join(current, name), algo)
    return found


def compare_command_files(repo, contract, trusted_entries, algo):
    patterns = contract["command_files"]
    trusted = {path: (entry[0], entry[2]) for path, entry in trusted_entries.items() if matches_any(patterns, path)}
    present = disk_files(repo, patterns, algo)
    for path in sorted(set(trusted) | set(present)):
        if trusted.get(path) != present.get(path):
            raise Stop(f"the command file {path} differs from the default-branch version, so no project command runs")


def compare_tree_command_files(repo, contract, trusted_entries, rev):
    patterns = contract["command_files"]
    trusted = {path: entry for path, entry in trusted_entries.items() if matches_any(patterns, path)}
    session = {path: entry for path, entry in tree_entries(repo, rev).items() if matches_any(patterns, path)}
    for path in sorted(set(trusted) | set(session)):
        if trusted.get(path) != session.get(path):
            raise Stop(f"the session changed the command file {path}, so the generator does not run in this step")


def worktree_block(repo):
    path = os.path.join(repo, "CLAUDE.md")
    if os.path.islink(path) or not os.path.isfile(path):
        return None
    with open(path, "rb") as handle:
        block, _ = contract_lines(handle.read().decode("utf-8", "replace"))
    return "\n".join(block) if block else None


def tree_block(repo, rev):
    entry = tree_entries(repo, rev).get("CLAUDE.md")
    if entry is None or entry[0] not in ("100644", "100755"):
        return None
    block, _ = contract_lines(read_blob(repo, entry[2]).decode("utf-8", "replace"))
    return "\n".join(block) if block else None


def snapshot(repo):
    out = git(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard").stdout.decode("utf-8", "surrogateescape")
    state = {}
    for path in sorted(set(p for p in out.split("\0") if p)):
        full = os.path.join(repo, path)
        try:
            info = os.lstat(full)
        except FileNotFoundError:
            state[path] = ("absent",)
            continue
        if stat.S_ISLNK(info.st_mode):
            state[path] = ("link", os.readlink(full))
        elif stat.S_ISREG(info.st_mode):
            with open(full, "rb") as handle:
                state[path] = ("file", hashlib.sha256(handle.read()).hexdigest(), bool(info.st_mode & stat.S_IXUSR))
        else:
            state[path] = ("other",)
    return state


def changed(before, after):
    paths = set(before) | set(after)
    return sorted(path for path in paths if before.get(path, ("absent",)) != after.get(path, ("absent",)))


def changed_vs_tree(repo, rev, algo):
    entries = tree_entries(repo, rev)
    out = git(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard").stdout.decode("utf-8", "surrogateescape")
    paths = set(p for p in out.split("\0") if p) | set(entries)
    result = []
    for path in sorted(paths):
        entry = entries.get(path)
        present = disk_entry(os.path.join(repo, path), algo)
        expected = (entry[0], entry[2]) if entry else None
        if present != expected:
            result.append(path)
    return result


def run_command(repo, command, path_env):
    argv = command.split(" ")
    home = tempfile.mkdtemp(prefix="rk-guide-home-")
    env = {
        "PATH": path_env,
        "HOME": home,
        "GIT_CONFIG_COUNT": "2",
        "GIT_CONFIG_KEY_0": "core.hooksPath",
        "GIT_CONFIG_VALUE_0": "/dev/null",
        "GIT_CONFIG_KEY_1": "core.fsmonitor",
        "GIT_CONFIG_VALUE_1": "false",
    }
    timed_out = False
    try:
        try:
            proc = subprocess.Popen(argv, cwd=repo, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as error:
            return 127, f"the command could not start: {error}", False
        try:
            out, _ = proc.communicate(timeout=COMMAND_TIMEOUT)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            out, _ = proc.communicate()
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        text = out.decode("utf-8", "replace")
        if len(text) > OUTPUT_LIMIT:
            text = "[output truncated to the last %d characters]\n" % OUTPUT_LIMIT + text[-OUTPUT_LIMIT:]
        return proc.returncode, text, timed_out
    finally:
        shutil.rmtree(home, ignore_errors=True)


def regenerate_and_verify(repo, contract, path_env):
    before = snapshot(repo)
    code, output, timed_out = run_command(repo, contract["regenerate"], path_env)
    if timed_out:
        raise Stop(f"the regenerate command did not end within {COMMAND_TIMEOUT} seconds", contract["regenerate"], code, output)
    if code != 0:
        raise Stop("the regenerate command failed", contract["regenerate"], code, output)
    after = snapshot(repo)
    regen_output = output
    for path in changed(before, after):
        if path not in contract["generated"]:
            raise Stop(f"the regenerate command changed {path}, which is not a stated generated file", contract["regenerate"], code, output)
        if after.get(path, ("absent",))[0] != "file":
            raise Stop(f"the regenerate command left {path} as something other than a regular file", contract["regenerate"], code, output)
    for path in contract["generated"]:
        full = os.path.join(repo, path)
        if os.path.lexists(full) and (os.path.islink(full) or not os.path.isfile(full)):
            raise Stop(f"the generated path {path} is not a regular file after the regenerate command", contract["regenerate"], code, output)
    code, output, timed_out = run_command(repo, contract["verify"], path_env)
    if timed_out:
        raise Stop(f"the verify command did not end within {COMMAND_TIMEOUT} seconds", contract["verify"], code, output)
    if code != 0:
        raise Stop("the verify command failed", contract["verify"], code, output)
    final = snapshot(repo)
    moved = changed(after, final)
    if moved:
        raise Stop(f"the verify command changed {moved[0]}, and a verify command must change nothing", contract["verify"], code, output)
    return regen_output, output


def write_state(path, data):
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    payload = (json.dumps(data, sort_keys=True, indent=1) + "\n").encode()
    temp = f"{path}.{secrets.token_hex(6)}"
    with open(temp, "wb") as handle:
        handle.write(payload)
    os.chmod(temp, 0o444)
    os.replace(temp, path)
    return hashlib.sha256(payload).hexdigest()


def load_state(path, digest):
    with open(path, "rb") as handle:
        payload = handle.read()
    if not digest or hashlib.sha256(payload).hexdigest() != digest:
        raise Stop("the guide contract state file does not match the digest the trusted workflow step recorded")
    return json.loads(payload)


def outside(path, repo):
    real = os.path.realpath(path)
    root = os.path.realpath(repo)
    return not (real == root or real.startswith(root + os.sep))


def emit(pairs):
    for key, value in pairs:
        print(f"{key}={one_line(value)}")


def print_stop(stop):
    print(f"result=stop")
    print(f"reason={one_line(stop.reason)}")
    if stop.command:
        print(f"command={stop.command}")
        print(f"exit={stop.exit_code}")
        print("----- command output -----")
        print(stop.output.rstrip("\n"))
        print("----- end of command output -----")


def cmd_sync_state(args):
    repo = os.path.abspath(args.repo)
    extra = os.environ.get("RK_EXTRA_ALLOWED", "")
    permit = os.environ.get("RK_GUIDE_PERMIT", "")
    runner = os.path.abspath(args.runner)
    state_file = os.path.abspath(args.state_file)
    data = {"kind": "sync", "repo": repo, "trusted": args.ref, "path": os.environ.get("PATH", "")}
    contract = None
    if not SHA_RE.match(args.ref or ""):
        state, reason = "unavailable", "the trusted default-branch commit is not a full commit identifier"
    elif not outside(state_file, repo):
        state, reason = "unavailable", "the state file is inside the workspace"
    elif not SAFE_ARG_RE.match(runner) or not SAFE_ARG_RE.match(state_file):
        state, reason = "unavailable", "the runner or state file path holds a character outside A-Z a-z 0-9 . _ / -"
    else:
        try:
            state, reason, contract, _ = trusted_contract(repo, args.ref)
        except Stop as stop:
            state, reason = "unavailable", stop.reason
        if state == "ok":
            permitted, why = permit_state(contract, permit)
            state, reason = ("ready", "") if permitted else ("denied", why)
    data.update({"state": state, "reason": reason, "contract": contract, "object_format": object_format(repo)})
    digest = write_state(state_file, data)
    check_line = f"python3 -I {runner} check --state-file {state_file} --state {digest}"
    run_line = f"python3 -I {runner} run --state-file {state_file} --state {digest}"
    emit([
        ("state", state),
        ("reason", reason),
        ("filtered_extra", filtered_extra(contract, extra) if contract else ""),
        ("digest", digest),
        ("check_command", check_line),
        ("run_command", run_line),
    ])
    return 0


def cmd_route_extra(args):
    repo = os.path.abspath(args.repo)
    extra = os.environ.get("RK_EXTRA_ALLOWED", "")
    contract = None
    if not SHA_RE.match(args.ref or ""):
        state, reason = "unavailable", "the trusted default-branch commit is not a full commit identifier"
    else:
        try:
            entry = tree_entries(repo, args.ref).get("CLAUDE.md")
            if entry is None or entry[1] != "blob" or entry[0] not in ("100644", "100755"):
                state, reason = "none", "the default branch has no regular CLAUDE.md file"
            else:
                state, reason, contract = parse_contract(read_blob(repo, entry[2]).decode("utf-8", "replace"))
        except Stop as stop:
            state, reason = "unavailable", stop.reason
    if state == "none":
        kept = extra
    elif state == "ok":
        kept = filtered_extra(contract, extra)
    else:
        kept = ""
    emit([("state", state), ("reason", reason), ("filtered_extra", kept)])
    return 0


def sync_preflight(data):
    if data.get("kind") != "sync":
        raise Stop("the state file is not a documentation sync state")
    if data.get("state") != "ready":
        raise Stop(f"the guide contract state is {data.get('state')}: {data.get('reason')}")
    repo = data["repo"]
    contract = data["contract"]
    trusted_entries = tree_entries(repo, data["trusted"])
    block = worktree_block(repo)
    if block != contract["block"]:
        raise Stop("the contract block in the work tree CLAUDE.md differs from the default-branch block")
    compare_command_files(repo, contract, trusted_entries, data["object_format"])
    return repo, contract


def cmd_check(args):
    try:
        data = load_state(args.state_file, args.state)
        sync_preflight(data)
    except Stop as stop:
        print_stop(stop)
        return 1
    contract = data["contract"]
    emit([
        ("result", "ok"),
        ("generated", ", ".join(contract["generated"])),
        ("sources", ", ".join(contract["sources"])),
        ("command_files", ", ".join(contract["command_files"])),
        ("regenerate", contract["regenerate"]),
        ("verify", contract["verify"]),
    ])
    return 0


def cmd_run(args):
    try:
        data = load_state(args.state_file, args.state)
        repo, contract = sync_preflight(data)
        regen_output, verify_output = regenerate_and_verify(repo, contract, data["path"])
    except Stop as stop:
        print_stop(stop)
        return 1
    emit([("result", "ok"), ("regenerate", contract["regenerate"]), ("verify", contract["verify"]), ("generated", ", ".join(contract["generated"]))])
    print("----- regenerate output -----")
    print(regen_output.rstrip("\n"))
    print("----- verify output -----")
    print(verify_output.rstrip("\n"))
    print("----- end of output -----")
    return 0


def read_refs(text):
    refs = {}
    for line in text.splitlines():
        parts = line.strip().split(" ", 1)
        if len(parts) == 2 and parts[1].startswith("refs/heads/"):
            refs[parts[1][len("refs/heads/"):]] = parts[0]
    return refs


def remote_head(slug, branch):
    if not SLUG_RE.match(slug) or not BRANCH_RE.match(branch) or ".." in branch:
        return None
    proc = subprocess.run(["gh", "api", f"repos/{slug}/git/ref/heads/{branch}", "--jq", ".object.sha"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        return None
    value = proc.stdout.decode().strip()
    return value if SHA_RE.match(value) else None


def config_state(worktree, flavor):
    listing = git(worktree, "config", "--list", "--includes", "-z").stdout.decode("utf-8", "surrogateescape")
    keys = []
    for record in listing.split("\0"):
        if not record:
            continue
        key, _, value = record.partition("\n")
        key = key.lower()
        if LOCAL_EXEC_KEY_RE.match(key) or (flavor == "codex" and NETWORK_KEY_RE.match(key)):
            keys.append([key, value])
    common = git_text(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir").strip()
    files = {}
    for rel in (os.path.join("info", "attributes"), os.path.join("info", "exclude")):
        full = os.path.join(common, rel)
        files[full] = ""
        if os.path.lexists(full):
            with open(full, "rb") as handle:
                files[full] = hashlib.sha256(handle.read()).hexdigest()
    return {"keys": keys, "files": files}


def check_config(data):
    now = config_state(data["worktree"], data["flavor"])
    if now["keys"] != data["config"]["keys"]:
        raise Stop("a git configuration key that can run a program or redirect a push changed after the revise pass was prepared")
    if now["files"] != data["config"]["files"]:
        raise Stop("the git attributes or exclude file changed after the revise pass was prepared")


def check_push_config(data):
    expected = {
        f"branch.{WORK_BRANCH}.remote": ["origin"],
        f"branch.{WORK_BRANCH}.merge": [f"refs/heads/{data['branch']}"],
        f"branch.{WORK_BRANCH}.pushremote": [],
        "push.default": ["upstream"] if data["flavor"] == "claude" else None,
        "remote.pushdefault": [],
        "remote.origin.push": [],
        "remote.origin.pushurl": [],
        "remote.origin.mirror": [],
    }
    for key, want in expected.items():
        if want is None:
            continue
        got = git(data["worktree"], "config", "--get-all", key, check=False).stdout.decode("utf-8", "replace").split("\n")
        got = [value for value in got if value]
        if got != want:
            raise Stop(f"the push configuration key {key} is not what the prepare step set, so nothing is pushed")


def ignored_files(worktree):
    out = git(worktree, "ls-files", "-z", "--others", "--ignored", "--exclude-standard").stdout.decode("utf-8", "surrogateescape")
    return sorted(path for path in out.split("\0") if path)


def write_prompt(template, out, data, contract):
    with open(template) as handle:
        text = handle.read().rstrip("\n")
    details = [
        "",
        "",
        f"The work tree for this pass is {data['worktree']}. Edit files only inside it.",
        f"The stated source files are: {', '.join(contract['sources'])}.",
        "The root CLAUDE.md is a stated source, so the rule 3 fallback to CLAUDE.md applies." if matches_any(contract["sources"], "CLAUDE.md") else "The root CLAUDE.md is not a stated source, so never edit it: when no existing stated source fits a rule, change nothing for that rule.",
        f"The stated generated files are: {', '.join(contract['generated'])}.",
        f"The stated command files are: {', '.join(contract['command_files'])}.",
        f"The session changes are the commits from refs/rk-guide/base to refs/rk-guide/session, the session branch {data['branch']}.",
        f"The optional commit message file is {os.path.join(data['worktree'], MESSAGE_FILE)}.",
    ]
    with open(out, "w") as handle:
        handle.write(text + "\n".join(details) + "\n")


def cmd_prepare(args):
    repo = os.path.abspath(args.repo)
    permit = os.environ.get("RK_GUIDE_PERMIT", "")
    try:
        if not SHA_RE.match(args.trusted or ""):
            raise Stop("the trusted default-branch commit was not recorded before the session ran")
        if not SLUG_RE.match(args.slug):
            raise Stop("the repository name is not owner/name")
        state, reason, contract, trusted_entries = trusted_contract(repo, args.trusted)
        if state == "none":
            emit([("state", "none"), ("reason", reason)])
            return 0
        if args.flow:
            emit([("state", "skip"), ("reason", "a documentation flow keeps the agent guides through its own sync, so the guide contract revise pass does not run")])
            return 0
        if state != "ok":
            raise Stop(f"the agent guide contract on the default branch is malformed: {reason}")
        permitted, why = permit_state(contract, permit)
        if not permitted:
            raise Stop(why)
        with open(args.refs_before) as handle:
            before = read_refs(handle.read())
        after = read_refs(git_text(repo, "for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"))
        candidates = sorted(
            name for name, sha in after.items()
            if before.get(name) != sha and name != args.default_branch and not name.startswith("rk-guide/")
        )
        if len(candidates) != 1:
            raise Stop(f"the session left {len(candidates)} new or moved local branches ({', '.join(candidates) or 'none'}), and this step needs exactly one")
        branch = candidates[0]
        if not BRANCH_RE.match(branch) or ".." in branch or git(repo, "check-ref-format", "--branch", branch, check=False).returncode != 0:
            raise Stop(f"the session branch name {branch!r} is not a safe branch name")
        session = after[branch]
        remote = remote_head(args.slug, branch)
        if remote != session:
            raise Stop(f"the session branch {branch} is not on the remote at its local commit {session}")
        if tree_block(repo, session) != contract["block"]:
            raise Stop(f"the session branch {branch} changed the agent guide contract block, so the generator does not run in this step")
        compare_tree_command_files(repo, contract, trusted_entries, session)
        worktree = os.path.join(repo, args.worktree)
        if os.path.lexists(worktree):
            raise Stop(f"the revise work tree path {args.worktree} already exists")
        base = ""
        for start in (args.start, args.trusted):
            if start and SHA_RE.match(start):
                base = git_text(repo, "merge-base", start, session, check=False).strip()
                if base:
                    break
        base = base or session
        git(repo, "worktree", "add", "-B", WORK_BRANCH, worktree, session)
        git(repo, "config", f"branch.{WORK_BRANCH}.remote", "origin")
        git(repo, "config", f"branch.{WORK_BRANCH}.merge", f"refs/heads/{branch}")
        if args.flavor == "claude":
            git(repo, "config", "push.default", "upstream")
        git(repo, "update-ref", "refs/rk-guide/base", base)
        git(repo, "update-ref", "refs/rk-guide/session", session)
        git(repo, "update-ref", "refs/rk-guide/trusted", args.trusted)
        data = {
            "kind": "revise",
            "flavor": args.flavor,
            "repo": repo,
            "worktree": worktree,
            "trusted": args.trusted,
            "branch": branch,
            "session": session,
            "contract": contract,
            "path": os.environ.get("PATH", ""),
            "object_format": object_format(repo),
            "config": None,
            "slug": args.slug,
        }
        data["config"] = config_state(worktree, args.flavor)
        write_prompt(args.prompt_template, args.prompt_out, data, contract)
        digest = write_state(args.state_file, data)
    except Stop as stop:
        emit([("state", "stop"), ("reason", stop.reason)])
        return 0
    emit([("state", "ready"), ("reason", ""), ("branch", branch), ("digest", digest)])
    return 0


def commit_message(worktree, model, effort, harness):
    path = os.path.join(worktree, MESSAGE_FILE)
    text = ""
    if os.path.lexists(path):
        if os.path.islink(path) or not os.path.isfile(path):
            raise Stop(f"{MESSAGE_FILE} is not a regular file")
        with open(path, "rb") as handle:
            raw = handle.read(8193)
        os.remove(path)
        try:
            candidate = raw.decode("utf-8")
        except UnicodeDecodeError:
            candidate = ""
        lines = [line.rstrip() for line in candidate.replace("\r\n", "\n").split("\n")]
        while lines and not lines[-1]:
            lines.pop()
        ok = (
            len(raw) <= 8192
            and lines
            and 0 < len(lines[0]) <= 100
            and not any(ch < " " and ch != "\t" for line in lines for ch in line)
            and (len(lines) == 1 or lines[1] == "")
        )
        if ok:
            text = "\n".join(lines)
    if not text:
        text = "docs: record session learnings in the agent guide sources and regenerate the agent guides"
    if not FOOTER_RE.search(text):
        text = f"{text}\n\n---\nUpdated with LLM: {model} | {effort} | Harness: {harness}"
    return text + "\n"


def cmd_settle(args):
    result_file = args.result_file
    try:
        data = load_state(args.state_file, args.state)
        if data.get("kind") != "revise":
            raise Stop("the state file is not a revise state")
        repo, worktree, contract = data["repo"], data["worktree"], data["contract"]
        check_config(data)
        check_push_config(data)
        head = git_text(worktree, "rev-parse", "HEAD").strip()
        tip = git_text(repo, "rev-parse", f"refs/heads/{WORK_BRANCH}").strip()
        current = git_text(worktree, "symbolic-ref", "-q", "HEAD", check=False).strip()
        if head != data["session"] or tip != data["session"] or current != f"refs/heads/{WORK_BRANCH}":
            raise Stop("the revise work tree no longer sits on the session commit, so nothing is committed")
        message = commit_message(worktree, args.model, args.effort, args.harness)
        algo = data["object_format"]
        hidden = ignored_files(worktree)
        if hidden:
            raise Stop(f"the revise pass left the ignored file {hidden[0]} in the work tree, so no project command runs")
        edits = changed_vs_tree(worktree, "HEAD", algo)
        if not edits:
            write_result(result_file, {"result": "none", "reason": "the revise pass changed no guide source"})
            emit([("result", "none")])
            return 0
        outside_sources = [path for path in edits if not matches_any(contract["sources"], path)]
        if outside_sources:
            raise Stop(f"the revise pass changed {outside_sources[0]}, which is not a stated source")
        if worktree_block(worktree) != contract["block"]:
            raise Stop("the revise pass changed the agent guide contract block")
        trusted_entries = tree_entries(repo, data["trusted"])
        compare_command_files(worktree, contract, trusted_entries, algo)
        regenerate_and_verify(worktree, contract, data["path"])
        final = changed_vs_tree(worktree, "HEAD", algo)
        allowed = [path for path in final if matches_any(contract["sources"], path) or path in contract["generated"]]
        if allowed != final:
            raise Stop("the work tree holds a change outside the stated sources and generated files")
        git(worktree, "--literal-pathspecs", "add", "-A", "--", *final)
        staged = sorted(p for p in git_text(worktree, "diff", "--cached", "--no-ext-diff", "--no-renames", "--name-only", "-z").split("\0") if p)
        if staged != sorted(final):
            raise Stop("the staged paths differ from the checked paths")
        git(worktree, "commit", "--no-verify", "-q", "-F", "-", data=message.encode())
        commit = git_text(worktree, "rev-parse", "HEAD").strip()
        record = {"result": "committed", "reason": "", "commit": commit, "paths": final}
        if data["flavor"] == "codex":
            push = git(worktree, "push", "origin", f"HEAD:refs/heads/{data['branch']}", check=False)
            if push.returncode != 0:
                raise Stop(f"the push of the agent guide commit {commit} to {data['branch']} failed: {one_line(push.stderr.decode('utf-8', 'replace'))}")
            record["result"] = "pushed"
        write_result(result_file, record)
        emit([("result", record["result"]), ("commit", commit)])
        return 0
    except Stop as stop:
        write_result(result_file, {"result": "stop", "reason": stop.reason, "command": stop.command, "exit": stop.exit_code, "output": stop.output})
        emit([("result", "stop"), ("reason", stop.reason)])
        return 0


def write_result(path, record):
    if not path:
        return
    with open(path, "w") as handle:
        json.dump(record, handle, sort_keys=True)


def fence_for(text):
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    return "`" * max(3, longest + 1)


def post_comment(slug, issue, body):
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
        handle.write(body)
        name = handle.name
    try:
        proc = subprocess.run(["gh", "api", "--method", "POST", f"repos/{slug}/issues/{issue}/comments", "-F", f"body=@{name}"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            print(f"::warning::The guide contract comment could not be posted: {one_line(proc.stderr.decode('utf-8', 'replace'))}")
    finally:
        os.remove(name)


def cmd_report(args):
    lines = []
    reason = ""
    command = ""
    exit_code = None
    output = ""
    data = None
    if args.prepare_state == "stop":
        reason = args.prepare_reason or "the revise pass could not be prepared"
    elif args.prepare_state == "ready":
        try:
            data = load_state(args.state_file, args.state)
        except (Stop, OSError, ValueError) as error:
            reason = getattr(error, "reason", None) or f"the revise state could not be read: {error}"
        record = {}
        if data is not None and args.result_file and os.path.isfile(args.result_file):
            with open(args.result_file) as handle:
                record = json.load(handle)
        result = record.get("result") or "missing"
        if data is not None and result == "stop":
            reason = record.get("reason") or "the revise pass stopped"
            command = record.get("command") or ""
            exit_code = record.get("exit")
            output = record.get("output") or ""
        elif data is not None and result in ("committed", "pushed"):
            remote = remote_head(data["slug"], data["branch"])
            if remote != record.get("commit"):
                reason = f"the agent guide commit {record.get('commit')} is not the tip of {data['branch']} on the remote, so the push did not land"
        elif data is not None and result != "none":
            reason = "the regenerate, verify, and commit step did not record a result"
        elif data is not None and args.revise_outcome not in ("success", ""):
            reason = f"the revise step ended with the outcome {one_line(args.revise_outcome)} before it edited a guide source, so the session learnings are not recorded"
    if data is not None:
        git(data["repo"], "worktree", "remove", "--force", data["worktree"], check=False)
        git(data["repo"], "worktree", "prune", check=False)
        git(data["repo"], "branch", "-D", WORK_BRANCH, check=False)
    if not reason:
        print("The guide contract step finished with nothing to report.")
        return 0
    lines.append("**The agent guide revise pass landed no guide commit.** The implementation is already pushed, and this step left the agent guides on the session branch unedited.")
    lines.append("")
    lines.append(f"Reason: {reason}.")
    if command:
        lines.append("")
        fence = fence_for(output)
        lines.append(f"Command: `{command}` (exit {exit_code})")
        lines.append("")
        lines.append(fence + "text")
        lines.append(output.rstrip("\n") or "(no output)")
        lines.append(fence)
    if args.run_url:
        lines.append("")
        lines.append(f"See the [run log]({args.run_url}).")
    print("\n".join(lines))
    if args.slug and args.issue and SLUG_RE.match(args.slug) and args.issue.isdigit():
        post_comment(args.slug, args.issue, "\n".join(lines) + "\n")
    return 0


def main():
    parser = argparse.ArgumentParser(prog="guide_contract.py")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("sync-state")
    p.add_argument("--repo", required=True)
    p.add_argument("--ref", required=True)
    p.add_argument("--state-file", required=True)
    p.add_argument("--runner", required=True)
    p.set_defaults(func=cmd_sync_state)
    p = sub.add_parser("route-extra")
    p.add_argument("--repo", required=True)
    p.add_argument("--ref", required=True)
    p.set_defaults(func=cmd_route_extra)
    for name, func in (("check", cmd_check), ("run", cmd_run)):
        p = sub.add_parser(name)
        p.add_argument("--state-file", required=True)
        p.add_argument("--state", required=True)
        p.set_defaults(func=func)
    p = sub.add_parser("prepare")
    p.add_argument("--repo", required=True)
    p.add_argument("--trusted", default="")
    p.add_argument("--start", default="")
    p.add_argument("--default-branch", required=True)
    p.add_argument("--refs-before", required=True)
    p.add_argument("--slug", required=True)
    p.add_argument("--state-file", required=True)
    p.add_argument("--worktree", default=".claude/worktrees/rk-guide-revise")
    p.add_argument("--prompt-template", required=True)
    p.add_argument("--prompt-out", required=True)
    p.add_argument("--flavor", choices=("claude", "codex"), required=True)
    p.add_argument("--flow", default="")
    p.set_defaults(func=cmd_prepare)
    p = sub.add_parser("settle")
    p.add_argument("--state-file", required=True)
    p.add_argument("--state", required=True)
    p.add_argument("--result-file", required=True)
    p.add_argument("--model", default="unknown")
    p.add_argument("--effort", default="unknown")
    p.add_argument("--harness", default="unknown")
    p.set_defaults(func=cmd_settle)
    p = sub.add_parser("report")
    p.add_argument("--prepare-state", default="")
    p.add_argument("--revise-outcome", default="")
    p.add_argument("--prepare-reason", default="")
    p.add_argument("--state-file", default="")
    p.add_argument("--state", default="")
    p.add_argument("--result-file", default="")
    p.add_argument("--slug", default="")
    p.add_argument("--issue", default="")
    p.add_argument("--run-url", default="")
    p.set_defaults(func=cmd_report)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
