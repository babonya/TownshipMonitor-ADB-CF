"""Scoped screenshot identity; quantity/price pixels never participate."""
import math
from pathlib import Path
import cv2
import numpy as np
from matching import ContractError, digest
from product_scores import select_product


class MarketProducts:
    def __init__(self, directory, registration, assets):
        self.templates = []
        if registration is None:
            return
        if registration.get('schema') != 1 or not isinstance(registration.get('templates'), list):
            raise ContractError('MARKET_SCREENSHOT_REGISTRATION_INVALID')
        seen = set()
        for spec in registration['templates']:
            try:
                if spec['templateId'] in seen or spec['scene'] != 'market' or not spec['itemId'] or not spec['layoutId']:
                    raise ValueError()
                seen.add(spec['templateId'])
                source = spec['source']
                if Path(source['file']).name != source['file'] or source['dimensions'] != spec['dimensions']:
                    raise ValueError()
                raw = (Path(directory) / source['file']).read_bytes()
                if digest(raw) != source['sha256'] or not source['frameId'] or source['identityReviewedBy'] != 'AI':
                    raise ValueError()
                original = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
                dimensions = spec['dimensions']
                if original.shape[:2] != (dimensions['height'], dimensions['width']):
                    raise ValueError()
                b, icon, quantity, region = (source[k] for k in ('cropBox', 'iconBox', 'quantityBox', 'region'))
                if region['space'] != 'registered_capture' or region['unit'] != 'fraction':
                    raise ValueError()
                for k, axis in [('x', 'width'), ('y', 'height'), ('width', 'width'), ('height', 'height')]:
                    if type(b[k]) is not int or not math.isfinite(region[k]) or not 0 <= region[k] <= 1 or round(region[k]*dimensions[axis]) != b[k]:
                        raise ValueError()
                if b['width'] < 16 or b['height'] < 16 or b['x'] < icon['x'] or b['y'] < icon['y'] or b['x']+b['width'] > icon['x']+icon['width'] or b['y']+b['height'] > min(quantity['y'], icon['y']+icon['height']):
                    raise ValueError()
                template = assets[spec['file']]
                if Path(spec['file']).name != spec['file'] or digest((Path(directory) / spec['file']).read_bytes()) != spec['sha256']:
                    raise ValueError()
                crop = original[b['y']:b['y']+b['height'], b['x']:b['x']+b['width']]
                if crop.shape != template.shape or not np.array_equal(crop, template) or float(np.std(template)) < 10:
                    raise ValueError()
                for key, low in [('minimumScore', .9), ('minimumMargin', .05)]:
                    if not math.isfinite(spec[key]) or not low <= spec[key] <= 1:
                        raise ValueError()
                self.templates.append((spec, template))
            except (KeyError, TypeError, ValueError, OSError, AttributeError):
                raise ContractError('MARKET_SCREENSHOT_REGISTRATION_INVALID') from None

    def match(self, image, icon, quantity, layout):
        uncertain = {'status': 'uncertain', 'itemId': None, 'reason': 'SCREENSHOT_PRODUCT_TEMPLATE_REQUIRED',
                     'identitySource': 'game_screenshot'}
        # Search only above the currently located quantity band. No scaling or
        # cross-scene fallback broadens the registered geometry.
        bottom = min(icon['y']+icon['height'], quantity['y'])
        search = image[icon['y']:bottom, icon['x']:icon['x']+icon['width']]
        candidates = []
        for spec, template in self.templates:
            if spec['layoutId'] != layout['id'] or spec['dimensions'] != layout['dimensions']:
                continue
            if any(search.shape[i] < template.shape[i] for i in (0, 1)):
                continue
            scores = cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED)
            scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
            _, score, _, location = cv2.minMaxLoc(scores)
            candidates.append({'itemId': spec['itemId'], 'score': float(score),
                               'minimumScore': spec['minimumScore'], 'minimumMargin': spec['minimumMargin'],
                               'spec': spec, 'location': location})
        selection = select_product(candidates, require_competitor=True)
        if not selection.best:
            return uncertain
        best = selection.best
        spec = best['spec']
        return {**uncertain, 'status': 'matched' if selection.matched else 'uncertain',
                'reason': None if selection.matched else 'SCREENSHOT_PRODUCT_AMBIGUOUS_OR_LOW_SCORE',
                'itemId': spec['itemId'] if selection.matched else None,
                'candidateItemId': spec['itemId'], 'templateId': spec['templateId'],
                'cropHash': spec['sha256'], 'matchScore': best['score'], 'scoreMargin': selection.margin,
                'minimumScore': spec['minimumScore'], 'minimumMargin': spec['minimumMargin'],
                'layoutId': layout['id'], 'dimensions': layout['dimensions']}
