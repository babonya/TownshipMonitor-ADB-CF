"""File/byte-only perception. This module has no ADB or input authority."""
from __future__ import annotations
from percentage_profile import resolve_percentage_profile


import json
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from image_assets import ContractError, decode, digest, verified_asset
from frame_context import FrameContext, timestamp, utc_now

VERSION = "township-matching-1"


def box(value, width, height):
    if not isinstance(value, dict):
        raise ContractError("BOX_INVALID")
    numbers = [value.get(k) for k in ("x", "y", "width", "height")]
    if any(type(n) is not int for n in numbers):
        raise ContractError("BOX_INVALID")
    x, y, w, h = numbers
    if x < 0 or y < 0 or w < 1 or h < 1 or x + w > width or y + h > height:
        raise ContractError("BOX_OUT_OF_BOUNDS")
    return x, y, w, h


def overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    area = max(0, min(ax + aw, bx + bw) - max(ax, bx)) * max(0, min(ay + ah, by + bh) - max(ay, by))
    return area / (aw * ah + bw * bh - area) if area else 0.0


def intersects(a, b):
    return min(a[0] + a[2], b[0] + b[2]) > max(a[0], b[0]) and min(a[1] + a[3], b[1] + b[3]) > max(a[1], b[1])


def local_file(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ContractError("TEMPLATE_PATH_INVALID")
    target = (root / value).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ContractError("TEMPLATE_OUTSIDE_REGISTRY")
    return target


@dataclass
class Template:
    spec: dict
    image: np.ndarray
    mask: np.ndarray | None
    rois: list
    exclusions: list
    threshold: float
    margin: float

    @property
    def identity(self):
        return self.spec["objectId"]

    @property
    def scene(self):
        return self.spec["scene"]


class Matcher:
    def __init__(self, registry_path):
        self.path = Path(registry_path).resolve()
        raw = self.path.read_bytes()
        self.registry_hash = digest(raw)
        registry = resolve_percentage_profile(json.loads(raw.decode("utf-8-sig")))
        if registry.get("schema") != 1 or not registry.get("version"):
            raise ContractError("REGISTRY_VERSION_INVALID")
        self.registry = registry
        self.width = registry["dimensions"]["width"]
        self.height = registry["dimensions"]["height"]
        if type(self.width) is not int or type(self.height) is not int or not (1 <= self.width <= 4096 and 1 <= self.height <= 4096):
            raise ContractError("REGISTRY_GEOMETRY_INVALID")
        self.profile_id = registry["profileId"]
        if not isinstance(self.profile_id, str) or not self.profile_id:
            raise ContractError("REGISTRY_PROFILE_INVALID")
        self.ttl_ms = registry.get("coordinateTtlMs", 2500)
        if type(self.ttl_ms) is not int or not 100 <= self.ttl_ms <= 30000:
            raise ContractError("COORDINATE_TTL_INVALID")
        self.scene_margin = registry.get("sceneMargin", 0.05)
        if type(self.scene_margin) not in (int, float) or not 0 <= self.scene_margin <= 1:
            raise ContractError("SCENE_MARGIN_INVALID")
        self.fallback_scenes = registry.get("fallbackScenes", [])
        if not isinstance(self.fallback_scenes, list) or any(not isinstance(s, str) for s in self.fallback_scenes):
            raise ContractError("FALLBACK_SCENES_INVALID")
        cv2.setNumThreads(1)
        self.templates = []
        ids = set()
        for spec in registry.get("templates", []):
            for key in ("templateId", "objectId", "scene", "category"):
                if not isinstance(spec.get(key), str) or not spec[key]:
                    raise ContractError("TEMPLATE_IDENTITY_INVALID")
            if spec["templateId"] in ids or spec["category"] not in ("building", "button", "item", "scene_marker", "currency", "card_state"):
                raise ContractError("TEMPLATE_IDENTITY_INVALID")
            ids.add(spec["templateId"])
            if type(spec.get("decisiveScene", False)) is not bool or (spec.get("decisiveScene") and spec["category"] != "scene_marker"):
                raise ContractError("DECISIVE_SCENE_MARKER_INVALID")
            image = verified_asset(local_file(self.path.parent, spec["file"]), spec.get("fileHash"), "TEMPLATE_HASH_MISMATCH").image
            mask = None
            if spec.get("maskFile"):
                mask_image = verified_asset(local_file(self.path.parent, spec["maskFile"]), spec.get("maskHash"), "MASK_HASH_MISMATCH").image
                mask = cv2.cvtColor(mask_image, cv2.COLOR_BGR2GRAY)
                if mask.shape != image.shape[:2] or np.count_nonzero(mask) < 16:
                    raise ContractError("MASK_INVALID")
                mask = np.where(mask > 0, 255, 0).astype(np.uint8)
            pixels = image[mask > 0] if mask is not None else image.reshape(-1, 3)
            if pixels.std(axis=0).max() < 2:
                raise ContractError("TEMPLATE_FLAT")
            full = {"x": 0, "y": 0, "width": self.width, "height": self.height}
            rois = [box(b, self.width, self.height) for b in spec.get("searchBoxes", [full])]
            if not rois:
                raise ContractError("SEARCH_BOX_REQUIRED")
            exclusions = [box(b, self.width, self.height) for b in spec.get("excludeBoxes", [])]
            threshold, margin = spec.get("threshold", 0.8), spec.get("margin", 0.05)
            if type(threshold) not in (int, float) or not 0 < threshold <= 1 or type(margin) not in (int, float) or not 0 <= margin <= 1:
                raise ContractError("THRESHOLD_INVALID")
            self.templates.append(Template(spec, image, mask, rois, exclusions, threshold, margin))
        if not self.templates or not any(t.spec["category"] == "scene_marker" for t in self.templates):
            raise ContractError("SCENE_MARKER_REQUIRED")

    def health(self):
        return {"version": VERSION, "registryHash": self.registry_hash, "templateSetVersion": self.registry["version"],
                "excludedObjectIds": sorted({q["label"]["objectId"] for q in self.registry.get("excludedTemplates", [])} -
                                          {t.identity for t in self.templates}),
                "quarantinedTemplateCount": len(self.registry.get("excludedTemplates", [])),
                "templateCount": len(self.templates), "profileId": self.profile_id, "opencv": cv2.__version__,
                "numpy": np.__version__, "ocrRequested": False, "executionAllowed": False}

    def _maps(self, image, template, rois=None):
        maps = []
        height, width = template.image.shape[:2]
        for x, y, w, h in template.rois if rois is None else rois:
            if w < width or h < height:
                continue
            roi = image[y:y+h, x:x+w]
            result = cv2.matchTemplate(roi, template.image, cv2.TM_CCOEFF_NORMED, mask=template.mask)
            good = np.isfinite(result) & (result >= -1.001) & (result <= 1.001)
            result = np.where(good, np.clip(result, -1, 1), -1).astype(np.float32)
            # Remove positions whose matched rectangle intersects an excluded region.
            for ex, ey, ew, eh in template.exclusions:
                left, top = max(0, ex - x - width + 1), max(0, ey - y - height + 1)
                right, bottom = min(result.shape[1], ex + ew - x), min(result.shape[0], ey + eh - y)
                if right > left and bottom > top:
                    result[top:bottom, left:right] = -1
            maps.append((x, y, result))
        return maps

    def _peaks(self, template, maps):
        candidates = []
        h, w = template.image.shape[:2]
        limit = template.spec.get("maxInstances", 8)
        if type(limit) is not int or not 1 <= limit <= 64:
            raise ContractError("MAX_INSTANCES_INVALID")
        for ox, oy, scores in maps:
            working = scores.copy()
            for _ in range(limit):
                _, score, _, location = cv2.minMaxLoc(working)
                if score < template.threshold:
                    break
                x, y = location
                candidates.append({"template": template, "score": float(score), "box": (ox+x, oy+y, w, h)})
                # Suppress only this occurrence, preserving disjoint instances.
                working[max(0, y-h//2):min(working.shape[0], y+h//2+1),
                        max(0, x-w//2):min(working.shape[1], x+w//2+1)] = -1
        return candidates

    def _runner(self, candidate, competitors):
        template = candidate["template"]
        x, y, w, h = candidate["box"]
        cx, cy = x+w/2, y+h/2
        best_score, best_id = None, None
        group = template.spec.get("competitionGroup", template.spec["category"])
        for other, maps in competitors:
            if other.identity == template.identity or other.spec.get("competitionGroup", other.spec["category"]) != group:
                continue
            oh, ow = other.image.shape[:2]
            for ox, oy, scores in maps:
                tx, ty = round(cx-ow/2-ox), round(cy-oh/2-oy)
                left, top = max(0, tx-6), max(0, ty-6)
                right, bottom = min(scores.shape[1], tx+7), min(scores.shape[0], ty+7)
                if right <= left or bottom <= top:
                    continue
                score = float(scores[top:bottom, left:right].max())
                if best_score is None or score > best_score:
                    best_score, best_id = score, other.identity
        return best_id, best_score

    def analyze(self, data: bytes, frame: dict, *, offline=False, now_ms=None, objects=True, scope="all", context=None):
        started = time.perf_counter()
        if scope not in ("all", "navigation"):
            raise ContractError("MATCHING_SCOPE_INVALID")
        context = FrameContext.read(data, frame) if context is None else context
        context.require_binding(data, frame)
        frame = context.frame
        image = context.image
        height, width = image.shape[:2]
        base = {"schema": 1, "version": VERSION, "frameId": frame["frameId"], "sequence": frame["sequence"],
                "epoch": frame["epoch"], "evidenceHash": frame["evidenceHash"], "observedAt": frame["observedAt"],
                "processedAt": utc_now(), "dimensions": {"width": width, "height": height},
                "profileId": self.profile_id, "templateSetVersion": self.registry["version"],
                "registryHash": self.registry_hash, "detections": [], "sceneCandidates": [], "scene": {"kind": "unknown", "status": "unknown"},
                "ocrRequested": False, "requiresGptReview": True, "executionAllowed": False, "scope": scope}
        def finish(state, reason=None):
            age = context.age_ms(now_ms)
            base.update(status=state, reason=reason, processedAt=utc_now(), ageMs=round(age, 3),
                        coordinateState="historical" if offline else "fresh" if 0 <= age <= self.ttl_ms and state == "candidate" else "unusable",
                        elapsedMs=round((time.perf_counter()-started)*1000, 3))
            return base
        if (width, height) != (self.width, self.height) or frame.get("dimensions") != {"width": width, "height": height}:
            return finish("unsupported", "FRAME_GEOMETRY_UNSUPPORTED")
        if frame.get("profileId", self.profile_id) != self.profile_id:
            return finish("unsupported", "FRAME_PROFILE_UNSUPPORTED")
        age = context.age_ms(now_ms)
        if not offline and (age < 0 or age > self.ttl_ms):
            return finish("stale", "FRAME_STALE")
        scene_scores = {}
        decisive_scores = {}
        base['sceneDiagnostics'] = []
        for template in self.templates:
            if template.spec["category"] != "scene_marker":
                continue
            maps = self._maps(image, template)
            score = max((float(m.max()) for _, _, m in maps), default=-1)
            base['sceneDiagnostics'].append({'templateId': template.spec['templateId'], 'kind': template.scene,
                                             'matchScore': round(score, 6), 'threshold': template.threshold})
            if score >= template.threshold:
                scene_scores[template.scene] = max(scene_scores.get(template.scene, -1), score)
                if template.spec.get("decisiveScene"):
                    decisive_scores[template.scene] = max(decisive_scores.get(template.scene, -1), score)
        ranked = sorted(scene_scores.items(), key=lambda p: p[1], reverse=True)
        base["sceneCandidates"] = [{"kind": k, "matchScore": round(v, 6)} for k, v in ranked]
        # Town HUD can remain visible behind a panel. Known panel markers take
        # precedence; the HUD fallback never establishes absence of all overlays.
        primary = [p for p in ranked if p[0] not in self.fallback_scenes]
        if decisive_scores:
            ranked = sorted(decisive_scores.items(), key=lambda p: p[1], reverse=True)
        elif primary:
            ranked = primary
        if not ranked:
            return finish("unknown", "SCENE_NOT_FOUND")
        if len(ranked) > 1 and ranked[0][1]-ranked[1][1] < self.scene_margin:
            return finish("ambiguous", "SCENE_AMBIGUOUS")
        scene = ranked[0][0]
        base["scene"] = {"kind": scene, "status": "candidate", "matchScore": round(ranked[0][1], 6),
                         "evidenceKind": "decisive_scene_marker" if scene in decisive_scores else "hud_fallback_unverified_occlusion" if scene in self.fallback_scenes else "panel_marker",
                         "occlusionVerified": False}
        if frame.get("expectedKind") not in (None, "unknown", scene):
            return finish("blocked", "SCENE_HINT_MISMATCH")
        if not objects:
            return finish("candidate")
        if scene == 'town' and scope == 'navigation':
            from town import town_features
            base['townFeatures'] = town_features(image)
        competitors = [(t, self._maps(image, t)) for t in self.templates if t.scene == scene and t.spec["category"] != "scene_marker"
                       and (scope == "all" or t.spec["category"] in ("building", "button"))]
        candidates = [c for template, maps in competitors for c in self._peaks(template, maps)]
        kept = []
        for candidate in sorted(candidates, key=lambda c: c["score"], reverse=True):
            if any(c["template"].identity == candidate["template"].identity and overlap(c["box"], candidate["box"]) >= 0.35 for c in kept):
                continue
            kept.append(candidate)
        for candidate in kept:
            template, (x, y, w, h) = candidate["template"], candidate["box"]
            runner_id, runner_score = self._runner(candidate, competitors)
            margin = candidate["score"]-runner_score if runner_score is not None else None
            ambiguous = margin is not None and margin < template.margin
            base["detections"].append({"category": template.spec["category"], "objectId": None if ambiguous else template.identity,
                                      "candidateId": template.identity, "itemId": None if ambiguous else template.spec.get("itemId"),
                                      "templateId": template.spec["templateId"], "box": {"x": x, "y": y, "width": w, "height": h},
                                      "center": {"x": x+w/2, "y": y+h/2}, "clickPoint": None,
                                      "matchScore": round(candidate["score"], 6), "runnerUpId": runner_id,
                                      "runnerUpScore": round(runner_score, 6) if runner_score is not None else None,
                                      "scoreMargin": round(margin, 6) if margin is not None else None,
                                      "status": "ambiguous" if ambiguous else "matched_candidate",
                                      "reason": "IDENTITY_MARGIN_INSUFFICIENT" if ambiguous else None})
        result = finish("candidate")
        # Processing can outlive the TTL even if the frame was fresh at entry.
        if not offline and result["coordinateState"] != "fresh":
            result["status"], result["reason"] = "stale", "PROCESSING_OUTLIVED_FRAME"
        return result
