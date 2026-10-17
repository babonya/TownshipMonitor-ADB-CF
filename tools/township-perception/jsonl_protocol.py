"""Bounded JSONL transport shared by independent perception processes."""
import json
import sys

MAX_LINE = 12 * 1024 * 1024


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), flush=True)


def serve(dispatch, health, *, stream=None, output=emit, max_line=MAX_LINE):
    stream = sys.stdin.buffer if stream is None else stream
    output({"kind": "ready", **health})
    while True:
        line = stream.readline(max_line + 1)
        if not line:
            return
        if len(line) > max_line:
            while line and not line.endswith(b"\n"):
                line = stream.readline(max_line + 1)
            output({"ok": False, "requestId": None, "error": "REQUEST_TOO_LARGE"})
            continue
        message = None
        try:
            message = json.loads(line)
            result = dispatch(message)
            output({"ok": True, "requestId": message.get("requestId"), "result": result})
        except (ValueError, KeyError, TypeError) as error:
            output({"ok": False, "requestId": message.get("requestId") if isinstance(message, dict) else None, "error": str(error)})
