"""Static button lettering from original game captures; no input coordinates."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


class OrderButtons:
    def __init__(self, path):
        path=Path(path); self.profile_bytes=path.read_bytes(); self.templates={}
        for a in json.loads(self.profile_bytes)['assets']:
            raw=(path.parent/a['file']).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=a['sha256']:raise ValueError('ORDER_BUTTON_ASSET_CHANGED')
            self.templates[a['role']]=cv2.imdecode(np.frombuffer(raw,np.uint8),1)

    def matches(self, role, im, region):
        x,y,w,h=(region[k] for k in ('x','y','width','height'))
        crop=im[y:y+h,x:x+w]; template=self.templates[role]
        # Invoked only inside the existing registered helicopter geometry.
        for scale in (1,.97,1.03):
            t=cv2.resize(template,None,fx=scale,fy=scale)
            if t.shape[0]>crop.shape[0] or t.shape[1]>crop.shape[1]:continue
            scores=cv2.matchTemplate(crop,t,cv2.TM_CCOEFF_NORMED)
            threshold=.92 if role=='speed_up' else .94
            if np.isfinite(scores).any() and float(np.nanmax(scores))>=threshold:return True
        return False

    def refreshing(self, im, region):
        return self.matches('waiting',im,region) or self.matches('speed_up',im,region)
