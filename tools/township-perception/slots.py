from percentage_profile import resolve_percentage_profile
from product_scores import select_product
from frame_context import FrameContext
"""Per-card identity competition. Layouts come from separately reviewed PNGs."""
import json
import time
from pathlib import Path
import cv2
from matching import ContractError, box, decode, digest, intersects, timestamp, utc_now


def inside(inner, outer):
    x, y, w, h = inner
    ox, oy, ow, oh = outer
    return ox <= x and oy <= y and x+w <= ox+ow and y+h <= oy+oh


class SlotAnalyzer:
    def __init__(self, matcher, layouts_file):
        self.matcher = matcher
        raw = Path(layouts_file).read_bytes()
        self.hash = digest(raw)
        document = resolve_percentage_profile(json.loads(raw.decode("utf-8-sig")))
        if document.get("schema") != 1 or not isinstance(document.get("version"), str) or not document["version"]:
            raise ContractError("LAYOUT_VERSION_INVALID")
        self.version = document["version"]
        self.layouts = {}
        for layout in document.get("layouts", []):
            identity = layout.get("layoutId")
            if not isinstance(identity, str) or not identity or identity in self.layouts or layout.get("scene") not in ("market", "barn"):
                raise ContractError("LAYOUT_ID_INVALID")
            if layout.get("dimensions") != {"width": matcher.width, "height": matcher.height}:
                raise ContractError("LAYOUT_GEOMETRY_INVALID")
            slots = layout.get("slots")
            if not isinstance(slots, list) or not 1 <= len(slots) <= 32:
                raise ContractError("LAYOUT_SLOTS_INVALID")
            seen, cards = set(), []
            for slot in slots:
                sid = slot.get("slotId")
                if not isinstance(sid, str) or not sid or sid in seen:
                    raise ContractError("SLOT_ID_INVALID")
                seen.add(sid)
                card = box(slot.get("cardBox"), matcher.width, matcher.height)
                if any(intersects(card, other) for other in cards):
                    raise ContractError("SLOT_CARDS_OVERLAP")
                cards.append(card)
                for field in ("iconBox", "quantityBox", "priceBox", "currencyBox"):
                    if field != "iconBox" and slot.get(field) is None:
                        continue  # Clipped quantities stay unknown; never request OCR.
                    if not inside(box(slot.get(field), matcher.width, matcher.height), card):
                        raise ContractError("SLOT_REGION_OUTSIDE_CARD")
            self.layouts[identity] = layout
        if not self.layouts:
            raise ContractError("LAYOUT_REQUIRED")

    def health(self):
        return {"layoutSetHash": self.hash, "layoutSetVersion": self.version, "layoutIds": sorted(self.layouts)}

    def currency(self, image, scene, region):
        if region is None:
            return {"currency": None, "currencyScore": None, "currencyStatus": "unknown"}
        scores = {}
        for template in self.matcher.templates:
            key = template.spec.get('currency')
            if template.scene != scene or template.spec['category'] != 'currency' or key not in ('COIN', 'TCASH'):
                continue
            values = self.matcher._maps(image, template, rois=[box(region, self.matcher.width, self.matcher.height)])
            score = max((float(m.max()) for _, _, m in values), default=-1)
            if score > scores.get(key, (-2, None))[0]:
                scores[key] = (score, template.threshold)
        ranked = sorted(scores.items(), key=lambda p:p[1][0], reverse=True)
        known = ranked and ranked[0][1][0] >= ranked[0][1][1] and (
            len(ranked) == 1 or ranked[0][1][0]-ranked[1][1][0] >= .05)
        return {"currency": ranked[0][0] if known else None, "currencyScore": round(ranked[0][1][0],6) if ranked else None,
                "currencyStatus": "matched_candidate" if known else "unknown"}

    def analyze(self, data, frame, layout_id, *, offline=False, now_ms=None):
        if layout_id not in self.layouts:
            raise ContractError("LAYOUT_UNSUPPORTED")
        started = time.perf_counter()
        layout = self.layouts[layout_id]
        context = FrameContext.read(data, frame)
        result = self.matcher.analyze(data, frame, offline=offline, now_ms=now_ms, objects=False, context=context)
        result.update(**self.health(), layoutId=layout_id, slots=[])
        if result["status"] != "candidate":
            return result
        if result["scene"]["kind"] != layout["scene"]:
            result.update(status="unsupported", reason="SCENE_LAYOUT_MISMATCH", coordinateState="unusable")
            return result
        image = context.image
        templates = [t for t in self.matcher.templates if t.scene == layout["scene"] and t.spec["category"] == "item" and t.spec.get("itemId")]
        for slot in layout["slots"]:
            roi = box(slot["iconBox"], self.matcher.width, self.matcher.height)
            candidates = []
            for template in templates:
                maps = self.matcher._maps(image, template, rois=[roi])
                for ox, oy, scores in maps:
                    _, score, _, (x, y) = cv2.minMaxLoc(scores)
                    item_id = template.spec["itemId"]
                    h, w = template.image.shape[:2]
                    candidates.append({"itemId": item_id, "template": template, "score": float(score), "box": (ox+x, oy+y, w, h),
                                       "minimumScore": template.threshold, "minimumMargin": template.margin})
            selection = select_product(candidates)
            best, runner, margin = selection.best, selection.runner, selection.margin
            matched, status = selection.matched, selection.status
            ambiguous = status == "ambiguous"
            entry = {"slotId": slot["slotId"], "cardBox": slot["cardBox"], "iconBox": slot["iconBox"], "quantityBox": slot["quantityBox"],
                     "priceBox": slot.get("priceBox"), "currencyBox": slot.get("currencyBox"),
                     **self.currency(image, layout["scene"], slot.get("currencyBox")),
                     "itemId": best["itemId"] if matched else None, "candidateItemId": best["itemId"] if best else None,
                     "matchScore": round(best["score"], 6) if best else None,
                     "runnerUpItemId": runner["itemId"] if runner else None, "runnerUpScore": round(runner["score"], 6) if runner else None,
                     "scoreMargin": round(margin, 6) if margin is not None else None, "quantity": None,
                     "quantityKind": "bundle_quantity" if layout["scene"] == "market" else "quantity", "status": status,
                     "reason": None if matched else "IDENTITY_MARGIN_INSUFFICIENT" if ambiguous else "ITEM_NOT_SUPPORTED_OR_NOT_FOUND"}
            result["slots"].append(entry)
            if matched:
                x, y, w, h = best["box"]
                result["detections"].append({"slotId": slot["slotId"], "category": "item", "objectId": best["template"].identity,
                                             "itemId": best["itemId"], "templateId": best["template"].spec["templateId"],
                                             "box": {"x": x, "y": y, "width": w, "height": h}, "center": {"x": x+w/2, "y": y+h/2},
                                             "matchScore": entry["matchScore"], "scoreMargin": entry["scoreMargin"], "status": status, "clickPoint": None})
        result.update(processedAt=utc_now(), elapsedMs=round((time.perf_counter()-started)*1000, 3))
        age = context.age_ms(now_ms)
        result["ageMs"] = round(age, 3)
        if not offline and not 0 <= age <= self.matcher.ttl_ms:
            result.update(status="stale", reason="PROCESSING_OUTLIVED_FRAME", coordinateState="unusable")
        return result
