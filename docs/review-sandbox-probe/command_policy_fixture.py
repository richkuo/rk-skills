import json
import sys
import time

BLOCK_MESSAGE = "rk-policy-fixture: the command policy blocked this command."

event = json.load(sys.stdin)
command = ""
tool_input = event.get("tool_input")
if isinstance(tool_input, dict) and isinstance(tool_input.get("command"), str):
    command = tool_input["command"]

if "rk-policy-crash-marker" in command:
    raise RuntimeError("rk-policy-fixture: forced crash")
if "rk-policy-sleep-marker" in command:
    time.sleep(60)
if "rk-policy-block-marker" in command:
    sys.stderr.write(BLOCK_MESSAGE + "\n")
    sys.exit(2)
sys.exit(0)
