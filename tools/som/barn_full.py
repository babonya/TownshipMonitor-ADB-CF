"""Static lettering from the supplied game capture; never an upgrade target."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


class BarnFullDetector:
    def __init__(self, path):
        path=Path(path); self.profile_bytes=path.read_bytes(); self.p=json.loads(self.profile_bytes)
        self.templates={}
        for a in self.p['anchors']:
            data=(path.parent/a['file']).read_bytes()
            if hashlib.sha256(data).hexdigest()!=a['sha256']:raise ValueError('BARN_FULL_ASSET_CHANGED')
            self.templates[a['role']]=cv2.imdecode(np.frombuffer(data,np.uint8),1)

    def detect(self, im, panel):
        # Panel geometry is measured on this image, so cropped attachments and
        # full native captures do not share an assumed screen origin or scale.
        scale=panel['width']/self.p['panel']['width']; hits={}
        if not .65<=scale<=2:return None
        for a in self.p['anchors']:
            r=a['search']; x=panel['x']+round(r['x']*panel['width']); y=panel['y']+round(r['y']*panel['height'])
            crop=im[y:y+round(r['height']*panel['height']),x:x+round(r['width']*panel['width'])]
            best=0; best_box=None
            for factor in [.97,.985,1,1.015,1.03]:
                t=cv2.resize(self.templates[a['role']],None,fx=scale*factor,fy=scale*factor)
                if crop.shape[0]<t.shape[0] or crop.shape[1]<t.shape[1]:continue
                _,score,_,point=cv2.minMaxLoc(cv2.matchTemplate(crop,t,cv2.TM_CCOEFF_NORMED))
                if np.isfinite(score) and score>best:
                    best=score;best_box=dict(x=x+point[0],y=y+point[1],width=t.shape[1],height=t.shape[0])
            if best>=.9:hits[a['role']]={'score':float(best),'box':best_box}
        return {'detected':True,'anchors':hits} if 'title' in hits or 'upgrade' in hits else None
