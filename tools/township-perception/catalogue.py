"""Hash-bound alpha-masked shared product identity. Never supplies game input."""
import json
import math
from collections import OrderedDict
from pathlib import Path
import cv2
import numpy as np
from matching import ContractError, box, digest


class ProductCatalogueMatcher:
    def __init__(self, manifest_file, threshold_file):
        self.manifest_path = Path(manifest_file).resolve()
        self.threshold_path = Path(threshold_file).resolve()
        raw = self.manifest_path.read_bytes()
        thresholds = self.threshold_path.read_bytes()
        self.manifest_hash, self.threshold_hash = digest(raw), digest(thresholds)
        self.manifest, self.thresholds = json.loads(raw), json.loads(thresholds)
        if self.manifest.get('schema') != 1 or self.thresholds.get('schema') != 1 or self.thresholds.get('catalogueManifestSha256') != self.manifest_hash:
            raise ContractError('CATALOGUE_BINDING_INVALID')
        self.items = self.manifest['items']
        ids = [s['itemId'] for s in self.items]
        if len(ids) != len(set(ids)) or set(ids) != set(self.thresholds['items']):
            raise ContractError('CATALOGUE_IDENTITIES_INVALID')
        self.files = {}
        self.originals = {}
        self.prepared = {}
        self.cache = OrderedDict()
        for path in (self.manifest_path, self.threshold_path):
            self.files[path] = self._identity(path)
        for spec in self.items:
            path = (self.manifest_path.parent / spec['file']).resolve()
            if self.manifest_path.parent not in path.parents:
                raise ContractError('CATALOGUE_ASSET_PATH_INVALID')
            data = path.read_bytes()
            if digest(data) != spec['sha256']:
                raise ContractError('CATALOGUE_ASSET_CHANGED')
            image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
            if image is None or image.ndim != 3 or image.shape[2] != 4 or not np.any(image[:, :, 3]):
                raise ContractError('CATALOGUE_ALPHA_REQUIRED')
            self.originals[spec['itemId']] = image
            self.files[path] = self._identity(path)
            for context in ('market', 'delivery'):
                entry = self.thresholds['items'][spec['itemId']][context]
                if not 0 <= entry['minimumScore'] <= 1 or not 0 < entry['minimumMargin'] <= 2:
                    raise ContractError('CATALOGUE_THRESHOLD_INVALID')

    @staticmethod
    def _identity(path):
        stat = path.stat()
        return stat.st_mtime_ns, stat.st_size

    def health(self):
        if any(self._identity(path) != identity for path, identity in self.files.items()):
            raise ContractError('CATALOGUE_DEPENDENCY_CHANGED')
        return {'catalogueManifestSha256': self.manifest_hash, 'thresholdSha256': self.threshold_hash,
                'catalogueVersion': self.manifest['version'], 'thresholdVersion': self.thresholds['version']}

    @staticmethod
    def color_score(raw_score, template, mask, pixels):
        # CCOEFF removes per-channel means. Preserve product color as independent
        # evidence so similarly shaped green gems cannot win a pale dairy icon.
        weights=mask.astype(np.float64)
        total=max(float(np.sum(weights)),1)
        source=np.sum(template.astype(np.float64)*weights[:,:,None],axis=(0,1))/total
        observed=np.sum(pixels.astype(np.float64)*weights[:,:,None],axis=(0,1))/total
        penalty=float(np.mean(np.abs(source-observed)))/255*.5
        return float(raw_score)-penalty, penalty

    def _templates(self, context, scales, full_product_sizes=None):
        key = context, tuple(scales), tuple(full_product_sizes or [])
        if key not in self.prepared:
            templates = []
            for spec in self.items:
                image = self.originals[spec['itemId']]
                variants = []
                sizes = set()
                item_scales = [size/max(spec['productBounds']['width'],spec['productBounds']['height']) for size in full_product_sizes] if full_product_sizes else scales
                for scale in item_scales:
                    size = max(2, round(image.shape[1]*scale)), max(2, round(image.shape[0]*scale))
                    if size in sizes:
                        continue
                    sizes.add(size)
                    scaled = cv2.resize(image, size, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
                    mask = scaled[:, :, 3].astype(np.float32)/255
                    # Original alpha excludes transparency, never screen overlays.
                    if np.sum(mask) >= 12:
                        variants.append((scaled[:, :, :3], mask, scale))
                templates.append((spec, variants))
            self.prepared[key] = templates
        return self.prepared[key]

    def match(self, image, region, context, *, scales=None, full_product_sizes=None, overlay_top=None, diagnostics=False, native_item=None):
        if context not in ('market', 'delivery'):
            raise ContractError('CATALOGUE_CONTEXT_INVALID')
        health = self.health()
        x, y, w, h = box(region, image.shape[1], image.shape[0])
        original_h=h
        if overlay_top is not None:
            h = min(h, int(overlay_top)-y)
        defaults = self.thresholds['defaults'][context]
        full_product_sizes = full_product_sizes or (defaults.get('fullProductMaxPixels') if scales is None else None)
        scales = scales or defaults.get('scales',[1])
        if not isinstance(scales, (list, tuple)) or not 1 <= len(scales) <= 40 or any(not isinstance(s, (int, float)) or not .01 <= s <= 3 for s in scales):
            raise ContractError('CATALOGUE_SCALES_INVALID')
        if full_product_sizes is not None and (not isinstance(full_product_sizes,(list,tuple)) or not 1<=len(full_product_sizes)<=40 or any(not isinstance(s,(int,float)) or not 20<=s<=200 for s in full_product_sizes)):
            raise ContractError('CATALOGUE_PRODUCT_SIZE_INVALID')
        base = {**health, 'status': 'uncertain', 'itemId': None, 'candidateItemId': None, 'matchScore': None,
                'scoreMargin': None, 'minimumScore': defaults['minimumScore'], 'minimumMargin': defaults['minimumMargin'],
                'box': None, 'cropHash': None, 'reason': 'NO_UNOCCLUDED_PRODUCT_REGION'}
        # An independently proven native identity can immediately use its
        # explicit fallback if this new context has no calibration. It cannot
        # become a shared match through this hint, and calibrated comparisons
        # still compete with every catalogue identity.
        if native_item is not None and not diagnostics:
            entry=self.thresholds['items'].get(native_item,{}).get(context)
            if entry and entry['calibrationStatus']!='saved_screen_calibrated':
                return {**base,'calibrationStatus':entry['calibrationStatus'],'reason':'CONTEXT_UNCALIBRATED'}
        if h < 2:
            return base
        pixels = image[y:y+h, x:x+w, :3]
        key = digest(pixels.tobytes()), (x, y, w, h), context, tuple(scales), tuple(full_product_sizes or []), diagnostics
        if key in self.cache:
            return json.loads(json.dumps(self.cache[key]))
        ranked = []
        for spec, variants in self._templates(context, scales, full_product_sizes):
            best = (-1.0, None, None)
            for template, mask, scale in variants:
                th, tw = template.shape[:2]
                if tw > w or th > h:
                    continue
                bounds=spec.get('productBounds')
                if bounds and (bounds['width']*scale>w+8 or bounds['height']*scale>original_h+8):
                    continue
                left,top,right,bottom=0,0,w-tw,h-th
                if 'productBounds' in spec and 'cropBox' in spec:
                    # Project retained geometry back to the full opaque product.
                    # A tiny upper patch at a random place in the card cannot
                    # establish identity. The full product must fit the icon ROI;
                    # overlays still constrain the exact compared band above.
                    bounds,crop=spec['productBounds'],spec['cropBox']
                    ox=(crop['x']-bounds['x'])*scale;oy=(crop['y']-bounds['y'])*scale
                    left=max(left,math.ceil(ox-4));top=max(top,math.ceil(oy-4))
                    right=min(right,math.floor(w+4-bounds['width']*scale+ox));bottom=min(bottom,math.floor(original_h+4-bounds['height']*scale+oy))
                if right<left or bottom<top:continue
                scores = cv2.matchTemplate(pixels[top:bottom+th,left:right+tw], template, cv2.TM_CCOEFF_NORMED, mask=mask)
                scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
                _, score, _, (dx, dy) = cv2.minMaxLoc(scores)
                if score > best[0]:
                    best = (min(1.0, float(score)), {'x': x+dx+left, 'y': y+dy+top, 'width': tw, 'height': th}, scale)
            if best[1] is not None:
                physical,scale=best[1],best[2]
                source=self.originals[spec['itemId']]
                template=cv2.resize(source,(physical['width'],physical['height']),interpolation=cv2.INTER_AREA if scale<1 else cv2.INTER_LINEAR)
                patch=image[physical['y']:physical['y']+physical['height'],physical['x']:physical['x']+physical['width'],:3]
                value,penalty=self.color_score(best[0],template[:,:,:3],template[:,:,3].astype(np.float32)/255,patch)
                best=(value,physical,scale)
            ranked.append((best[0], spec, best[1], best[2]))
        ranked.sort(key=lambda p: p[0], reverse=True)
        if ranked and ranked[0][2] is not None:
            score, spec, physical, scale = ranked[0]
            margin = score-ranked[1][0] if len(ranked) > 1 else 2
            entry = self.thresholds['items'][spec['itemId']][context]
            calibrated = entry['calibrationStatus'] == 'saved_screen_calibrated'
            known = calibrated and score >= entry['minimumScore'] and margin >= entry['minimumMargin']
            failures = ([] if calibrated else ['CONTEXT_UNCALIBRATED'])
            if score < entry['minimumScore']:
                failures.append('SCORE_BELOW_MINIMUM')
            if margin < entry['minimumMargin']:
                failures.append('MARGIN_BELOW_MINIMUM')
            base.update(status='matched' if known else 'uncertain', itemId=spec['itemId'] if known else None,
                        candidateItemId=spec['itemId'], matchScore=round(score, 6), scoreMargin=round(margin, 6),
                        minimumScore=entry['minimumScore'], minimumMargin=entry['minimumMargin'], box=physical,
                        cropHash=spec['sha256'], scale=scale, calibrationStatus=entry['calibrationStatus'],
                        reason=None if known else 'CONTEXT_UNCALIBRATED' if not calibrated else 'IDENTITY_SEPARATION_INSUFFICIENT')
            base['rejectionReasons'] = failures
            base['runnerUp'] = ({'itemId': ranked[1][1]['itemId'], 'matchScore': round(ranked[1][0], 6)}
                                if len(ranked) > 1 else None)
            if diagnostics:
                base['competition'] = [{'itemId': s['itemId'], 'matchScore': round(v, 6), 'box': b, 'scale': k} for v, s, b, k in ranked]
        if len(self.cache) >= 64:
            self.cache.popitem(last=False)
        self.cache[key] = base
        return json.loads(json.dumps(base))
