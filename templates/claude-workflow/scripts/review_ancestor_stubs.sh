#!/usr/bin/env bash
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  echo "::error::Review refused: python3 is required to prepare the workspace ancestor stubs safely."
  exit 1
fi
python3 -I - "$GITHUB_WORKSPACE" << 'PY'
import errno
import os
import pwd
import secrets
import stat
import sys

MCP_CONTENT = b'{"mcpServers":{}}\n'
workspace = sys.argv[1]
os.umask(0o022)
rejected = []

def report(kind, path, detail=""):
    print(f"{kind}: {path}{(' (' + detail + ')') if detail else ''}")

def ancestors_of(path):
    found = []
    current = os.path.dirname(path.rstrip("/") or "/")
    while current and current != "/":
        found.append(current)
        current = os.path.dirname(current)
    return found

candidates = []
for source in (workspace, os.path.realpath(workspace)):
    for ancestor in ancestors_of(source):
        canonical = os.path.realpath(ancestor)
        if canonical != "/" and canonical not in candidates:
            candidates.append(canonical)

def open_dir_nofollow(path):
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in [p for p in path.split("/") if p]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
    except BaseException:
        os.close(fd)
        raise
    return fd

def entry_state(fd, name):
    try:
        return os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None

def check_dir_entry(fd, path, name, st, created):
    target = f"{path}/{name}"
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
        report("rejected", target, "exists and is not a real directory")
        rejected.append(target)
        return
    report("created" if created else "kept", target)

def check_file_entry(fd, path, name, st, created):
    target = f"{path}/{name}"
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        report("rejected", target, "exists and is not a regular file")
        rejected.append(target)
        return
    report("created" if created else "kept", target)

def home_owner(path, owner):
    try:
        entry = pwd.getpwuid(owner)
    except KeyError:
        return None
    if entry.pw_dir and os.path.realpath(entry.pw_dir) == path:
        return entry
    return None

def warn_home_stub(fd, path, owner_entry):
    if not owner_entry:
        return
    st = entry_state(fd, ".claude")
    if st is None or st.st_uid != 0:
        return
    print(f"::warning::{path}/.claude is a root-owned directory in the home directory of {owner_entry.pw_name}. The scrub sandbox of a root review needs it there (anthropics/claude-code#97731), so it stays. Claude Code run by {owner_entry.pw_name} cannot write its settings in it. To give the directory back, move the runner out of that home, then run: sudo rm -r {path}/.claude")

def ensure_claude_dir(fd, path):
    name = ".claude"
    st = entry_state(fd, name)
    if st is not None:
        check_dir_entry(fd, path, name, st, False)
        return
    try:
        os.mkdir(name, 0o755, dir_fd=fd)
    except FileExistsError:
        st = entry_state(fd, name)
        if st is None:
            report("rejected", f"{path}/{name}", "changed during creation")
            rejected.append(f"{path}/{name}")
            return
        check_dir_entry(fd, path, name, st, False)
        return
    new_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        os.fchmod(new_fd, 0o755)
        st = os.fstat(new_fd)
    finally:
        os.close(new_fd)
    if st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o755:
        report("rejected", f"{path}/{name}", "created with the wrong owner or mode")
        rejected.append(f"{path}/{name}")
        return
    check_dir_entry(fd, path, name, st, True)

def ensure_mcp_file(fd, path):
    name = ".mcp.json"
    st = entry_state(fd, name)
    if st is not None:
        check_file_entry(fd, path, name, st, False)
        return
    temp_name = f".mcp.json.rk-{os.getpid()}-{secrets.token_hex(8)}"
    temp_fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=fd)
    try:
        try:
            os.write(temp_fd, MCP_CONTENT)
            os.fchmod(temp_fd, 0o644)
            os.fsync(temp_fd)
        finally:
            os.close(temp_fd)
        try:
            os.link(temp_name, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
            created = True
        except FileExistsError:
            created = False
    finally:
        try:
            os.unlink(temp_name, dir_fd=fd)
        except FileNotFoundError:
            pass
    st = entry_state(fd, name)
    if st is None:
        report("rejected", f"{path}/{name}", "changed during creation")
        rejected.append(f"{path}/{name}")
        return
    if created and (st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o644):
        report("rejected", f"{path}/{name}", "created with the wrong owner or mode")
        rejected.append(f"{path}/{name}")
        return
    check_file_entry(fd, path, name, st, created)

for path in candidates:
    try:
        fd = open_dir_nofollow(path)
    except OSError as error:
        report("rejected", path, f"cannot open without following a link: {errno.errorcode.get(error.errno, error.errno)}")
        rejected.append(path)
        continue
    try:
        owner = os.fstat(fd).st_uid
        if owner == 0:
            continue
        owner_entry = home_owner(path, owner)
        if owner_entry:
            print(f"ancestor owned by uid {owner} is the home of {owner_entry.pw_name}: {path}")
        else:
            print(f"ancestor owned by uid {owner}: {path}")
        ensure_claude_dir(fd, path)
        ensure_mcp_file(fd, path)
        warn_home_stub(fd, path, owner_entry)
    except OSError as error:
        report("rejected", path, f"stub preparation failed: {errno.errorcode.get(error.errno, error.errno)}")
        rejected.append(path)
    finally:
        os.close(fd)

if rejected:
    print("::error::Review refused: the workspace ancestor stubs could not be prepared safely, so the scrub sandbox cannot run. Safe entries stay in place. Rejected: " + ", ".join(rejected))
    sys.exit(1)
PY

