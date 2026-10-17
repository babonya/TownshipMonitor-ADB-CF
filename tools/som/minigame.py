"""Recognize only the helicopter title, reward cash icon and Play lettering."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


class MinigameDetector:
    def __init__(self, path):
        path=Path(path)
        self.profile_bytes=path.read_bytes()
        self.p=json.loads(self.profile_bytes)
        self.templates={}
        for anchor in self.p['anchors']:
            data=(path.parent/anchor['file']).read_bytes()
            if hashlib.sha256(data).hexdigest()!=anchor['sha256']:
                raise ValueError('MINIGAME_ASSET_CHANGED')
            self.templates[anchor['role']]=cv2.imdecode(np.frombuffer(data,np.uint8),1)

    def detect(self, image, viewport):
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'))
        layout=self.p.get('layout',self.p)
        source_width=layout['dimensions']['width']*layout['viewport']['width']
        scale=w/source_width
        # This evidence supports the supplied layout and nearby native size.
        # It does not invent geometry for arbitrary aspect ratios or locales.
        source_height=layout['dimensions']['height']*layout['viewport']['height']
        if not .8<=scale<=1.25 or abs((w/h)/(source_width/source_height)-1)>.06:
            return None
        hits={}
        for anchor in self.p['anchors']:
            search=anchor['search']
            left=x+round(search['x']*w);top=y+round(search['y']*h)
            crop=image[top:top+round(search['height']*h),left:left+round(search['width']*w)]
            template=self.templates[anchor['role']];best=None
            for factor in self.p['scales']:
                s=scale*factor*anchor.get('templateScale',1)
                t=cv2.resize(template,None,fx=s,fy=s,interpolation=cv2.INTER_LINEAR)
                th,tw=t.shape[:2]
                if th>crop.shape[0] or tw>crop.shape[1]:continue
                scores=cv2.matchTemplate(crop,t,cv2.TM_CCOEFF_NORMED)
                _,score,_,point=cv2.minMaxLoc(scores)
                if np.isfinite(score) and (best is None or score>best['score']):
                    best=dict(score=float(score),region=dict(x=(left+point[0]-x)/w,y=(top+point[1]-y)/h,width=tw/w,height=th/h))
            if best is None or best['score']<self.p['threshold']:return None
            hits[anchor['role']]=best
        if hits['cash']['region']['y']>=hits['play']['region']['y']:return None
        return dict(detected=True,unit='fraction',space='game',anchors=hits)
