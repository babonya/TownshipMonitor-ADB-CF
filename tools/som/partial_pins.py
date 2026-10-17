"""Supplement Android order pins with registered paired red side strips."""
import cv2
import numpy as np


def red_mask(image):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    return ((hsv[:, :, 1] > 170) & (hsv[:, :, 2] > 215) &
            ((hsv[:, :, 0] < 15) | (hsv[:, :, 0] > 170))).astype(np.uint8) * 255


class PartialPins:
    def __init__(self, profile, templates):
        self.spec = profile.get('partialPins')
        self.dimensions = profile['dimensions']
        self.map = profile['heli']['map']
        self.templates = []
        if self.spec is None:
            return
        s = self.spec
        if s.get('unit') != 'fraction' or s.get('space') != 'registered_capture':
            raise ValueError('PARTIAL_PIN_PERCENTAGE_REQUIRED')
        for name in ('alignment', 'suppression', 'duplicateRadius'):
            if any(not isinstance(s[name].get(k), (float, int)) or
                   not 0 < s[name][k] < 1 for k in ('x', 'y')):
                raise ValueError('PARTIAL_PIN_PERCENTAGE_REQUIRED')
        if len(s['patches']) != 2 or {p['centerDirection'] for p in s['patches']} != {'left', 'right'}:
            raise ValueError('PARTIAL_PIN_PAIR_REQUIRED')
        for p in s['patches']:
            if any(not 0 < p['centerOffset'][k] < 1 for k in ('x', 'y')):
                raise ValueError('PARTIAL_PIN_PERCENTAGE_REQUIRED')
        for scale in s['scales']:
            pair = []
            for p in s['patches']:
                mask = red_mask(templates[p['file']])
                if np.ptp(mask) == 0:
                    raise ValueError('PARTIAL_PIN_TEMPLATE_EMPTY')
                t = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
                ox = round(p['centerOffset']['x'] * self.dimensions['width'] * scale)
                oy = round(p['centerOffset']['y'] * self.dimensions['height'] * scale)
                pair.append((t, ox if p['centerDirection'] == 'right' else -ox, oy))
            self.templates.append(pair)

    def extend(self, image, pins):
        if self.spec is None:
            return pins
        height, width = image.shape[:2]
        if self.dimensions != dict(width=width, height=height):
            return pins
        s = self.spec
        mask = red_mask(image)
        rx = round(s['alignment']['x'] * width)
        ry = round(s['alignment']['y'] * height)
        kernel = np.ones((ry * 2 + 1, rx * 2 + 1), np.uint8)
        combined = np.full((height, width), -1, np.float32)
        for pair in self.templates:
            fields = []
            for template, ox, oy in pair:
                scores = cv2.matchTemplate(mask, template, cv2.TM_CCOEFF_NORMED)
                field = np.full_like(combined, -1)
                x0, y0 = max(0, ox), max(0, oy)
                x1, y1 = min(width, ox + scores.shape[1]), min(height, oy + scores.shape[0])
                field[y0:y1, x0:x1] = scores[y0-oy:y1-oy, x0-ox:x1-ox]
                fields.append(cv2.dilate(field, kernel))
            np.maximum(combined, np.minimum(*fields), out=combined)
        m = {k: round(v * (width if k in ('x', 'width') else height)) for k, v in self.map.items()}
        combined[:m['y']] = -1
        combined[m['y']+m['height']:] = -1
        combined[:, :m['x']] = -1
        combined[:, m['x']+m['width']:] = -1
        sx, sy = round(s['suppression']['x'] * width), round(s['suppression']['y'] * height)
        dx, dy = s['duplicateRadius']['x'] * width, s['duplicateRadius']['y'] * height
        result = list(pins)
        while True:
            _, score, _, (x, y) = cv2.minMaxLoc(combined)
            if not np.isfinite(score) or score < s['minimumScore']:
                break
            combined[max(0, y-sy):y+sy+1, max(0, x-sx):x+sx+1] = -1
            if any(((x-(p['visualBox']['x']+p['visualBox']['width']/2))/dx)**2 +
                   ((y-(p['visualBox']['y']+p['visualBox']['height']/2))/dy)**2 <= 1 for p in result):
                continue
            # Existing routing clicks the observed center, not an inferred V tip.
            # Worker frame/hash binding and route fractional conversion are reused.
            target = dict(x=x-1, y=y-1, width=2, height=2)
            result.append(dict(id=f'partial:{x}:{y}', color='red', box=target,
                               visualBox=dict(target), selected=False, partial=True))
        return result
