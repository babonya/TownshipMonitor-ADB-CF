from percentage_profile import resolve_percentage_profile
"""Two-row physical market recognition. Candidates never authorize input."""
import json
from pathlib import Path
import cv2
import numpy as np
from matching import ContractError, decode, digest
from image_assets import verified_asset
from frame_context import frame_pixels
from market_fields import field_box, validate_fields
from market_products import MarketProducts


class MarketPerception:
    def __init__(self, profile_file, catalogue=None):
        self.path = Path(profile_file)
        raw = self.path.read_bytes()
        self.profile = resolve_percentage_profile(json.loads(raw.decode('utf-8-sig')))
        self.profile_hash = digest(raw)
        if self.profile.get('schema') != 1:
            raise ContractError('MARKET_PROFILE_INVALID')
        for layout in self.profile['layouts']:
            validate_fields(layout)
        self.templates = {}
        for a in self.profile['assets']:
            path = self.path.parent / a['file']
            if path.parent != self.path.parent:
                raise ContractError('MARKET_ASSET_CHANGED')
            self.templates[a['file']] = verified_asset(path, a['sha256'], 'MARKET_ASSET_CHANGED',
                decoder=lambda data: cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)).image
        self.catalogue = catalogue
        self.products = MarketProducts(self.path.parent, self.profile.get('screenshotProducts'), self.templates)

    def health(self):
        return {'marketProfileHash': self.profile_hash, 'marketProfileVersion': self.profile['version'],
                **(self.catalogue.health() if self.catalogue else {})}

    @staticmethod
    def _cut(image, b):
        return image[b['y']:b['y']+b['height'], b['x']:b['x']+b['width']]

    def _exact(self, image, spec):
        crop = self._cut(image, spec['box'])
        template = self.templates[spec['file']]
        return crop.shape == template.shape and np.array_equal(crop, template)

    def _native_static(self, image, spec):
        crop = self._cut(image, spec['box'])
        template = self.templates[spec['file']]
        # Actual native title differs at isolated channels by one 8-bit level.
        # Geometry and every static pixel remain registered, not correlated.
        return bool(crop.shape == template.shape and np.max(np.abs(crop.astype(np.int16)-template.astype(np.int16))) <= 1)

    def _located_anchor(self, image, spec):
        locator = spec.get('locator')
        b = locator.get('searchBox') if isinstance(locator, dict) else None
        if not b or locator.get('schema') != 1 or any(type(b.get(k)) is not int for k in ('x', 'y', 'width', 'height')):
            return False
        height, width = image.shape[:2]
        if b['x'] < 0 or b['y'] < 0 or b['width'] < 1 or b['height'] < 1 or b['x']+b['width'] > width or b['y']+b['height'] > height:
            return False
        template = self.templates[spec['file']]
        crop = self._cut(image, b)
        if crop.shape[0] < template.shape[0] or crop.shape[1] < template.shape[1]:
            return False
        th, tw = template.shape[:2]
        rows, columns = crop.shape[0]-th+1, crop.shape[1]-tw+1
        candidates = np.ones((rows, columns), dtype=bool)
        for y, x in [(0, 0), (th-1, tw-1), (th//2, tw//2), (0, tw-1), (th-1, 0)]:
            candidates &= np.all(crop[y:y+rows, x:x+columns] == template[y, x], axis=2)
        ys, xs = np.where(candidates)
        count = 0
        for y, x in zip(ys, xs):
            if np.array_equal(crop[y:y+template.shape[0], x:x+template.shape[1]], template):
                count += 1
                if count > 1:
                    return False
        return count == 1

    @staticmethod
    def _rejection_modal(image):
        """Conservative opaque common dialog shape; never authorizes a click."""
        height, width = image.shape[:2]
        pale = cv2.inRange(image, np.array([130, 185, 210], np.uint8), np.array([255, 255, 255], np.uint8))
        pale = cv2.morphologyEx(pale, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
        b, g, r = (image[:, :, i].astype(np.int16) for i in range(3))
        colored = (((g > r+20) & (g > b+20) & (g > 130)) |
                   ((b > r+25) & (b > g+10) & (b > 120))).astype(np.uint8)*255
        buttons = [cv2.boundingRect(c) for c in cv2.findContours(colored, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]]
        candidates = []
        for c in cv2.findContours(pale, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
            x, y, w, h = cv2.boundingRect(c)
            if not width*.25 <= w <= width*.8 or not height*.15 <= h <= height*.65 or not width*.25 <= x+w/2 <= width*.75 or not height*.25 <= y+h/2 <= height*.85:
                continue
            if np.mean(pale[y:y+h, x:x+w] > 0) < .55:
                continue
            matches = [(bx, by, bw, bh) for bx, by, bw, bh in buttons if bw >= 90 and bh >= 35 and
                       x <= bx and bx+bw <= x+w and y+h*.5 <= by and by+bh <= y+h and
                       np.mean(colored[by:by+bh, bx:bx+bw] > 0) >= .45]
            if len(matches) != 1:
                continue
            bx, by, bw, bh = matches[0]
            candidates.append({'mode': 'opaque_common_dialog', 'panelBox': {'x': x, 'y': y, 'width': w, 'height': h},
                'buttonBox': {'x': bx, 'y': by, 'width': bw, 'height': bh},
                'messageBox': {'x': x+round(w*.08), 'y': y+round(h*.1), 'width': round(w*.84), 'height': min(96, round(h*.3))},
                'liveErrorEvidence': False})
        return candidates[0] if len(candidates) == 1 else None

    def _locations(self, image, role, viewport, threshold=.97, layout_id=None):
        crop = self._cut(image, viewport)
        points = []
        for spec in [a for a in self.profile['assets'] if a.get('role') == role]:
            if spec.get('layoutIds') and layout_id not in spec['layoutIds']:
                continue
            template = self.templates[spec['file']]
            if min(crop.shape[:2]) < 1 or any(crop.shape[i] < template.shape[i] for i in (0, 1)):
                continue
            mask = None
            if spec.get('maskExcludeBoxes'):
                mask = np.ones(template.shape[:2], np.uint8) * 255
                for b in spec['maskExcludeBoxes']:
                    mask[b['y']:b['y']+b['height'], b['x']:b['x']+b['width']] = 0
            scores = cv2.matchTemplate(crop, template, cv2.TM_CCOEFF_NORMED, mask=mask)
            scores = np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1)
            # Suppress nearby duplicate responses; physical positions are never IDs.
            count=0
            while count < 24:
                _, score, _, loc = cv2.minMaxLoc(scores)
                if not np.isfinite(score) or score < threshold:
                    break
                x, y = loc;px,py=x+viewport['x'],y+viewport['y'];count+=1
                if not any(abs(p['x']-px)<20 and abs(p['y']-py)<20 for p in points):
                    points.append({'x': px, 'y': py, 'width': template.shape[1], 'height': template.shape[0],
                                   'score': float(score), 'cardOffset': spec.get('cardOffset')})
                scores[max(0,y-20):y+21, max(0,x-20):x+21] = -1
        return points

    def analyze(self, data, base, *, context=None):
        image = frame_pixels(data, base, context)
        if image.shape[2] == 4:
            image = image[:, :, :3]
        result = {**base, **self.health(), 'status': 'unsupported', 'scene': {'kind': 'market'},
                  'reason': 'MARKET_NATIVE_EVIDENCE_REQUIRED', 'rows': [], 'market': None,
                  'executionAllowed': False, 'requiresGptReview': True, 'ocrRequested': False}
        result['rejectionModal'] = self._rejection_modal(image)
        dimensions = {'width': image.shape[1], 'height': image.shape[0]}
        layouts = [p for p in self.profile['layouts'] if p['dimensions'] == dimensions and
                   all((self._located_anchor(image, a) if 'locator' in a else self._native_static(image, a) if p.get('cellLocator') == 'structure_coin' else self._exact(image, a)) for a in p['anchors'])]
        if len(layouts) != 1:
            return result
        p = layouts[0]
        view = p['viewport']
        native_structure = p.get('cellLocator') == 'structure_coin'
        coins = self._locations(image, 'offer_structure' if native_structure else 'coin', view,
                                p.get('structureMinimumScore', .94), p['id'])
        sold = self._locations(image, 'sold', view, .94, p['id'])
        plus = self._locations(image, 'plus', view, .97, p['id'])
        sale_leftmost = bool(p.get('leftmostCue') and self._locations(image, 'sale', p['leftmostCue']['box'], .98, p['id']))
        leftmost = sale_leftmost
        rows = []
        for state, points in [('offer', coins), ('sold', sold)]:
            for marker in points:
                # Coin and SOLD are separate UI anchors. Values below are
                # measured offsets in this saved layout, not device scaling.
                offset=marker['cardOffset']
                x = marker['x']-offset['x']
                y = marker['y']-offset['y']
                row = min((0, 1), key=lambda r: abs(y-p['rows'][r]))
                if abs(y-p['rows'][row]) > 3:
                    continue
                y = p['rows'][row]
                card = {'x': x, 'y': y, 'width': p['cardWidth'], 'height': p['cardHeight']}
                full = x >= view['x'] and x+card['width'] <= view['x']+view['width']
                if native_structure and state == 'offer':
                    b = p['currencySearchOffset']
                    search = {'x': x+b['x'], 'y': y+b['y'], 'width': b['width'], 'height': b['height']}
                    currency_points = self._locations(image, 'coin', search, .94, p['id'])
                    if not currency_points:
                        continue
                    coin_marker = max(currency_points, key=lambda v: v['score'])
                else:
                    coin_marker = marker
                # Full icon geometry supports original-relative crop alignment.
                # Quantity pixels are outside the identity scoring area.
                fields = p['fieldGeometry']
                icon = field_box(fields['card'], 'iconBox', x, y)
                quantity = field_box(fields['card'], 'quantityBox', x, y)
                currency = field_box(fields['currency'], 'box', coin_marker['x'], coin_marker['y']) if state == 'offer' else None
                purchase = field_box(fields['card'], 'purchaseBox', x, y)
                price = field_box(fields['card'], 'priceBox', x, y) if 'priceBox' in fields['card'] else None
                screenshot_only = self.profile.get('screenshotProductsOnly', False)
                identity = {'status': 'uncertain', 'itemId': None,
                            'reason': 'SCREENSHOT_PRODUCT_TEMPLATE_REQUIRED' if screenshot_only else 'PRODUCT_CATALOGUE_REQUIRED'}
                if state == 'offer' and full:
                    if screenshot_only:
                        identity = self.products.match(image, icon, quantity, p)
                    elif self.catalogue:
                        identity = self.catalogue.match(image, icon, 'market', overlay_top=quantity['y'])
                rows.append({'slotId': f'r{row}:{x}', 'row': row, 'column': x,
                             'state': state, 'fullyVisible': full, 'cardBox': card, 'iconBox': icon,
                             'quantityBox': quantity, 'purchaseBox': purchase, 'currencyBox': currency,
                             **({'priceBox': price} if price else {}),
                             'currency': 'COIN' if state == 'offer' else None,
                             'identity': identity, 'itemId': identity.get('itemId'),
                             'identityConfirmed': False,
                             'contentHash': digest(self._cut(image, card).tobytes()),
                             'binding': {'frameId': base['frameId'], 'evidenceHash': base['evidenceHash'],
                                         'slotId': f'r{row}:{x}'}})
                if native_structure and full:
                    # Scrolling changes fractional raster alignment even when
                    # the same offer remains visible. A small original-pixel
                    # descriptor verifies overlap without product guesses.
                    rows[-1]['overlapPixels'] = cv2.resize(self._cut(image, card), (12, 12),
                        interpolation=cv2.INTER_AREA).reshape(-1).tolist()
        # A normal first column replaces special SALE offers after refresh.
        # Both complete ordinary rows must align at the registered left edge;
        # a clipped, displaced or one-row column never establishes entry.
        if native_structure and not leftmost:
            first_x = view['x'] + p['firstColumnOffset']['x']
            leftmost = all(any(r['row'] == row and r['fullyVisible'] and r['state'] in ('offer', 'sold') and
                              abs(r['cardBox']['x']-first_x) <= 1 for r in rows) for row in (0, 1))
        # The special sale card is excluded: its currency and artwork cannot
        # create an ordinary bundle. No dealer/paid controls become targets.
        if sale_leftmost:
            sale = p['leftmostCue']['box']
            rows = [r for r in rows if r['cardBox']['x'] >= sale['x']+sale['width']-10 or r['row'] == 1]
        rows.sort(key=lambda r: (r['column'], r['row']))
        result.update(status='candidate', reason=None, valueState='unreviewed', rows=rows,
                      market={'layoutId': p['id'], 'viewport': view, 'anchors': [a['box'] for a in p['anchors']],
                              'closeBox': p['close']['box'], 'refreshCaptionVerified': self._native_static(image, p['refreshCaption']) if native_structure else self._exact(image, p['refreshCaption']),
                              'refreshTimerBox': p['refreshTimerBox'], 'leftmostVerified': leftmost,
                              'columnPitch': p['columnPitch'],
                              'plusVisible': bool(plus), 'executionEnabled': p['executionEnabled'],
                              'nativeSourceResultRegistered': p.get('nativeSourceResultRegistered', False),
                              'viewportHash': digest(self._cut(image, view).tobytes())})
        return result
