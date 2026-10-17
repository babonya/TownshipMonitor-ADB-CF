"""On-demand CPU OCR, separately initialized from the image-matching worker."""
import contextlib
import importlib.metadata
import math
import sys
import time
from pathlib import Path
import cv2
from matching import ContractError, box, decode, digest, timestamp, utc_now
from fields import parse_field


class OcrEngine:
    def __init__(self, engine=None):
        started = time.perf_counter()
        cv2.setNumThreads(1)
        if engine is None:
            # Library logs must not corrupt the JSONL protocol on stdout.
            with contextlib.redirect_stdout(sys.stderr):
                from rapidocr import RapidOCR
                engine = RapidOCR(params={"Global.log_level": "warning", "Global.use_cls": False,
                                          "EngineConfig.onnxruntime.intra_op_num_threads": 1,
                                          "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                                          "EngineConfig.onnxruntime.use_cuda": False,
                                          "EngineConfig.onnxruntime.use_dml": False})
        self.engine = engine
        model_dir = getattr(getattr(getattr(engine, "cfg", None), "Global", None), "model_root_dir", None)
        self.models = [{"file": f.name, "sha256": digest(f.read_bytes())} for f in sorted(Path(model_dir).glob("*.onnx"))] if model_dir else []
        self.initialization_ms = (time.perf_counter()-started)*1000

    def health(self):
        return {"version": "township-ocr-1", "provider": "rapidocr", "rapidocr": importlib.metadata.version("rapidocr"),
                "onnxruntime": importlib.metadata.version("onnxruntime"), "languageProfile": "en-US-evaluation",
                "cpuOnly": True, "models": self.models, "initializationMs": round(self.initialization_ms, 3), "executionAllowed": False}

    def analyze(self, data, frame, fields, *, scene, offline=False, now_ms=None):
        started = time.perf_counter()
        if (not isinstance(frame, dict) or not isinstance(frame.get("frameId"), str) or not frame["frameId"]
                or type(frame.get("epoch")) is not int or frame["epoch"] < 0
                or type(frame.get("sequence")) is not int or frame["sequence"] < 0):
            raise ContractError("FRAME_REQUIRED")
        if frame.get("evidenceHash") != digest(data):
            raise ContractError("FRAME_HASH_MISMATCH")
        observed = timestamp(frame.get("observedAt"))
        image = decode(data)
        height,width=image.shape[:2]
        supported = (width,height) in ((1600,900),(1114,735),(1578,1268))
        # Supplied market screenshots are recognition evidence only. Their
        # physical geometry does not register any live device input.
        if offline and scene == 'market':
            supported = supported or (width,height) in ((1443,981),(1451,976),(1444,974))
        if offline and scene == 'barn':
            supported = supported or (width,height) in ((1452,873),(1414,888),(1455,971))
        if not supported or frame.get("dimensions") != {"width":width,"height":height}:
            raise ContractError("FRAME_GEOMETRY_UNSUPPORTED")
        if scene not in ("market", "barn", "train", "airport", "helicopter", "mayors_cup_result") or frame.get("expectedKind") != scene:
            raise ContractError("OCR_SCENE_BINDING_REQUIRED")
        if not isinstance(fields, list) or not 1 <= len(fields) <= 16:
            raise ContractError("FIELDS_INVALID")
        specs = self._field_specs(fields, width, height)
        now = time.time()*1000 if now_ms is None else now_ms
        base = {"schema": 1, **self.health(), "frameId": frame["frameId"], "epoch": frame["epoch"], "sequence": frame["sequence"],
                "observedAt": frame["observedAt"], "evidenceHash": frame["evidenceHash"], "dimensions": frame["dimensions"],
                "scene": scene, "fields": [], "requiresGptReview": True, "ocrRequested": True, "executionAllowed": False}
        if not offline and (now-observed < 0 or now-observed > 30000):
            return {**base, "status": "stale", "reason": "FRAME_STALE", "processedAt": utc_now(), "elapsedMs": 0}
        base["fields"] = [self._recognize_field(image, spec) for spec in specs]
        base.update(processedAt=utc_now(), elapsedMs=round((time.perf_counter()-started)*1000, 3),
                    status="candidate", valueState="historical" if offline else "unreviewed")
        if not offline and (time.time()*1000 if now_ms is None else now_ms)-observed > 30000:
            base.update(status="stale", valueState="unusable", reason="PROCESSING_OUTLIVED_FRAME")
        return base

    def recognize_region(self, image, field):
        """Read one current raster region; callers own frame/hash provenance."""
        height, width = image.shape[:2]
        spec = self._field_specs([field], width, height)[0]
        return self._recognize_field(image, spec)

    @staticmethod
    def _field_specs(fields, width, height):
        ids, specs = set(), []
        for field in fields:
            if not isinstance(field, dict) or not isinstance(field.get("fieldId"), str) or not field["fieldId"] or field["fieldId"] in ids:
                raise ContractError("FIELD_ID_INVALID")
            ids.add(field["fieldId"])
            if field.get("kind") not in ("text", "stock_pair", "capacity", "quantity", "bundle_quantity", "price_number"):
                raise ContractError("FIELD_KIND_UNSUPPORTED")
            bounds = box(field.get("box"), width, height)
            scale, score = field.get("scale", 2), field.get("minimumScore", 0.85)
            if type(scale) is not int or not 1 <= scale <= 4 or bounds[2]*bounds[3]*scale*scale > 2_000_000:
                raise ContractError("OCR_SCALE_INVALID")
            if type(score) not in (int, float) or not math.isfinite(score) or not .5 <= score <= 1:
                raise ContractError("OCR_MINIMUM_SCORE_INVALID")
            if type(field.get("recognitionOnly", True)) is not bool:
                raise ContractError("OCR_MODE_INVALID")
            specs.append((field, bounds, scale, score))
        return specs

    def _recognize_field(self, image, spec):
        field, (x, y, w, h), scale, score = spec
        crop = image[y:y+h, x:x+w]
        if scale != 1:
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        with contextlib.redirect_stdout(sys.stderr):
            output = self.engine(crop, use_det=not field.get("recognitionOnly", True), use_cls=False, use_rec=True)
        texts = list(output.txts) if output.txts is not None else []
        scores = [float(s) for s in output.scores] if output.scores is not None else []
        parsed = parse_field(" ".join(texts), field["kind"], scores, score)
        # A numeric field must be a single recognised line. Combining loose
        # fragments could manufacture a missing slash or cross card edges.
        if field["kind"] != "text" and len(texts) != 1:
            parsed.update(value=None, status="unknown", reason="OCR_FRAGMENTED_FIELD")
        return {"fieldId": field["fieldId"], "kind": field["kind"], "slotId": field.get("slotId"),
                               "itemId": field.get("itemId"), "identityConfirmed": False,
                               "box": field["box"], "scale": scale, "recognitionOnly": field.get("recognitionOnly", True),
                               "ocrScores": scores, **parsed}
