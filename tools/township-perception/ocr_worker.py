"""Separate persistent JSONL OCR process. Requests must list explicit fields."""
import argparse
import base64
import json
import sys
from pathlib import Path
from matching import ContractError
from ocr import OcrEngine
from jsonl_protocol import emit, serve


def request(engine, message):
    if not isinstance(message, dict) or message.get("op") != "ocr" or type(message.get("offline", False)) is not bool:
        raise ContractError("OCR_REQUEST_INVALID")
    return engine.analyze(base64.b64decode(message["imageBase64"], validate=True), message.get("frame"),
                          message.get("fields"), scene=message.get("scene"), offline=message.get("offline", False))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--serve", action="store_true")
    p.add_argument("--request")
    a = p.parse_args()
    engine = OcrEngine()
    if not a.serve:
        if not a.request:
            p.error("--request JSON required without --serve")
        emit({"ok": True, "result": request(engine, json.loads(Path(a.request).read_text(encoding="utf-8-sig")))})
        return
    serve(lambda message: request(engine, message), engine.health())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
