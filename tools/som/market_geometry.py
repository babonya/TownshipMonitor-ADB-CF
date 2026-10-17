"""Measure gaps against the recognized wooden market viewport; no product ID."""
import numpy as np


def market_gap_geometry(im, view, rows, card_width, card_height):
    w = view['width']
    line = np.ones(w, dtype=bool)
    for y in rows:
        band = im[y+round(card_height*.70):y+round(card_height*.95),
                  view['x']:view['x']+w]
        if band.size == 0 or band.shape[1] != w:
            return None
        # The dark vertical space between two wooden price plates must occur
        # at the same x in both rows. Product art and digits cannot supply it.
        dark = (band[:, :, 0] < 140) & (band[:, :, 1] < 75) & (band[:, :, 2] < 120)
        line &= dark.mean(axis=0) > .85
    idx = np.where(line)[0]
    runs = np.split(idx, np.where(np.diff(idx) > 1)[0]+1)
    gaps = [(r[0]+r[-1])/2 for r in runs if card_width*.025 <= len(r) <= card_width*.20
            and r[0] > w*.01 and r[-1] < w*.99]
    if len(gaps) < 3:
        return None
    diffs = np.diff(gaps)
    pitch = float(np.median(diffs))
    if not card_width <= pitch <= card_width*1.3 or np.max(np.abs(diffs-pitch)) > 3:
        return None
    offsets = [g-round((g-gaps[0])/pitch)*pitch for g in gaps]
    phase = float(np.median(offsets)) % pitch
    return {'unit': 'fraction', 'space': 'market_view', 'basis': view,
            'pitch': pitch/w, 'phase': phase/w, 'gaps': [float(g)/w for g in gaps]}
