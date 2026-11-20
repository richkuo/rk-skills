import argparse
import json
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--port-file", required=True)
parser.add_argument("--script", required=True)
parser.add_argument("--log", required=True)
parser.add_argument("--fail", action="store_true")
parser.add_argument("--marker", action="append", default=[])
args = parser.parse_args()

with open(args.script) as handle:
    COMMANDS = json.load(handle)

LOCK = threading.Lock()


def log(record):
    with LOCK:
        with open(args.log, "a") as handle:
            handle.write(json.dumps(record) + "\n")


def tool_results(messages):
    results = []
    for message in messages:
        if message.get("role") != "user" or not isinstance(message.get("content"), list):
            continue
        for block in message["content"]:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                results.append(block)
    return results


def result_text(block):
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


def has_bash(body):
    return any(isinstance(tool, dict) and tool.get("name") == "Bash" for tool in body.get("tools") or [])


def sse(handler, events):
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "close")
    handler.end_headers()
    for name, data in events:
        handler.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
        handler.wfile.flush()
    handler.close_connection = True


def message_events(model, block, stop_reason):
    message_id = "msg_" + uuid.uuid4().hex[:24]
    start = dict(block)
    deltas = []
    if block["type"] == "tool_use":
        start = {"type": "tool_use", "id": block["id"], "name": block["name"], "input": {}}
        deltas.append({"type": "input_json_delta", "partial_json": json.dumps(block["input"])})
    else:
        start = {"type": "text", "text": ""}
        deltas.append({"type": "text_delta", "text": block["text"]})
    events = [
        ("message_start", {"type": "message_start", "message": {"id": message_id, "type": "message", "role": "assistant", "model": model, "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": start}),
    ]
    for delta in deltas:
        events.append(("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": delta}))
    events += [
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop_reason, "stop_sequence": None}, "usage": {"output_tokens": 1}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return message_id, events


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def reply_json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply_json(404, {"type": "error", "error": {"type": "not_found_error", "message": "mock"}})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        path = self.path.split("?")[0]
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = {}
        for marker in args.marker:
            if marker.encode() in raw:
                log({"event": "marker", "text": marker})
        if path.endswith("/messages/count_tokens"):
            self.reply_json(200, {"input_tokens": 1})
            return
        if not path.endswith("/messages"):
            self.reply_json(404, {"type": "error", "error": {"type": "not_found_error", "message": "mock"}})
            return
        model = body.get("model", "mock")
        stream = bool(body.get("stream"))
        if not has_bash(body):
            block = {"type": "text", "text": "ok"}
            stop = "end_turn"
        else:
            if args.fail:
                log({"event": "forced_failure"})
                self.reply_json(400, {"type": "error", "error": {"type": "invalid_request_error", "message": "forced probe failure"}})
                return
            results = tool_results(body.get("messages") or [])
            if results:
                last = results[-1]
                log({"event": "tool_result", "index": len(results) - 1, "is_error": bool(last.get("is_error")), "text": result_text(last)})
            index = len(results)
            if index < len(COMMANDS):
                log({"event": "dispatch", "index": index})
                entry = COMMANDS[index]
                if isinstance(entry, dict):
                    name, tool_input = entry["name"], entry["input"]
                else:
                    name, tool_input = "Bash", {"command": entry, "description": f"probe step {index}"}
                block = {"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:24], "name": name, "input": tool_input}
                stop = "tool_use"
            else:
                log({"event": "done"})
                block = {"type": "text", "text": "probe complete"}
                stop = "end_turn"
        message_id, events = message_events(model, block, stop)
        if stream:
            sse(self, events)
            return
        content = [block] if block["type"] == "text" else [{"type": "tool_use", "id": block["id"], "name": block["name"], "input": block["input"]}]
        self.reply_json(200, {"id": message_id, "type": "message", "role": "assistant", "model": model, "content": content, "stop_reason": stop, "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}})


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(args.port_file, "w") as handle:
    handle.write(str(server.server_address[1]))
try:
    server.serve_forever()
except KeyboardInterrupt:
    sys.exit(0)
