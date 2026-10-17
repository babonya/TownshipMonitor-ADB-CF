"""Recognize a product tooltip from screenshot-derived static artwork."""
import cv2
import numpy as np


def product_tooltips(image, markers):
    # Recognize the broad popup body and its internal artwork only.
    b, g, r = cv2.split(image)
    cream = ((b >= 230) & (g >= 243) & (r >= 250)).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(cream, 8)
    matches = []
    for component in range(1, count):
        cx, cy, cw, ch, _ = [int(v) for v in stats[component]]
        if cw < 180 or ch < 120:
            continue
        mask = labels[cy:cy+ch, cx:cx+cw] == component
        occupied = mask.any(axis=1)
        left = mask.argmax(axis=1)
        right = cw-mask[:, ::-1].argmax(axis=1)
        # Body rows span a broad area even when text leaves holes. Use the
        # longest consecutive broad band, independent of narrow appendages
        # or the component's total height. No component expansion is used.
        rows = np.flatnonzero(occupied & (right-left >= 180))
        if not len(rows):
            continue
        bands = np.split(rows, np.flatnonzero(np.diff(rows) != 1)+1)
        body = max(bands, key=len)
        if not 120 <= len(body) <= 420:
            continue
        top, bottom = int(body[0]), int(body[-1])+1
        x, y = cx+int(left[body].min()), cy+top
        w, h = int(right[body].max())-(x-cx), bottom-top
        if w > 700 or np.count_nonzero(mask[top:bottom, x-cx:x-cx+w]) < w*h*.45:
            continue
        region = image[y:y+h, x:x+w]
        best, marker_top = -1.0, None
        for marker in markers:
            for scale in (.75, .875, 1.0, 1.125, 1.25):
                tw, th = round(marker.shape[1]*scale), round(marker.shape[0]*scale)
                if tw > w or th > h:
                    continue
                template = cv2.resize(marker, (tw, th), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
                scores = cv2.matchTemplate(region, template, cv2.TM_CCOEFF_NORMED)
                _, score, _, (_, dy) = cv2.minMaxLoc(np.nan_to_num(scores, nan=-1, posinf=-1, neginf=-1))
                if score > best:
                    best, marker_top = float(score), dy
        if best < .91:
            continue
        if marker_top is None or marker_top < 24:
            continue
        name = region[10:marker_top-8, 12:w-12].astype(np.int16)
        ink = (name[:,:,2] > 70) & (name[:,:,1] < 160) & (name[:,:,0] < 120) & (name[:,:,2] > name[:,:,1]+20)
        if np.count_nonzero(ink) < 20:
            continue
        header = region[10:min(marker_top-8, round(marker_top*.7)), 12:w-12].astype(np.int16)
        background = (header[:,:,2] > 220) & (header[:,:,1] > 200) & (header[:,:,0] > 170)
        lettering = (header[:,:,2] > 60) & (header[:,:,2] > header[:,:,1]+10) & (header[:,:,1] < 190) & (header[:,:,0] < 165)
        # Reject foreign overlays covering part of the name. This is a visual
        # visibility check; the AI still reads the saved original, not OCR here.
        if np.mean(~background & ~lettering) > .015:
            continue
        name_box = {'x': x+12, 'y': y+10, 'width': w-24,
                    'height': min(marker_top-8, round(marker_top*.7))-10}
        if name_box['height'] < 16:
            continue
        matches.append({'box': {'x': x, 'y': y, 'width': w, 'height': h},
                        'nameBox': name_box, 'matchScore': round(best, 6)})
    return matches
