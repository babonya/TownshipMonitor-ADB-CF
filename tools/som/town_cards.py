"""Recognize the Town Cards reward screen (YOUR CARDS title + TAP TO OPEN/CLAIM text)."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


class TownCardsDetector:
    def __init__(self, path):
        path=Path(path)
        self.profile_bytes=path.read_bytes()
        self.p=json.loads(self.profile_bytes)
        self.templates={}
        for anchor in self.p['anchors']:
            data=(path.parent/anchor['file']).read_bytes()
            if hashlib.sha256(data).hexdigest()!=anchor['sha256']:
                raise ValueError('TOWN_CARDS_ASSET_CHANGED')
            self.templates[anchor['role']]=cv2.imdecode(np.frombuffer(data,np.uint8),1)
        # Reference lettering masks (TAP TO OPEN / TAP TO CLAIM) from the registered captures.
        self.states={}
        tr=self.p['textRegion'];m=self.p['textMask'];dim=self.p['dimensions']
        for ev in self.p['evidence']:
            data=(path.parent/ev['file']).read_bytes()
            if hashlib.sha256(data).hexdigest()!=ev['sha256']:
                raise ValueError('TOWN_CARDS_ASSET_CHANGED')
            im=cv2.imdecode(np.frombuffer(data,np.uint8),1)
            self.states[ev['state']]=(ev['sha256'],self.mask(self.band(im,dict(x=0,y=0,width=dim['width'],height=dim['height'])),m))

    def band(self, image, viewport):
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'));tr=self.p['textRegion']
        b=dict(x=x+round(tr['x']*w),y=y+round(tr['y']*h),width=round(tr['width']*w),height=round(tr['height']*h))
        return b,image[b['y']:b['y']+b['height'],b['x']:b['x']+b['width']]

    @staticmethod
    def mask(banded, m):
        # Normalise to the registered band size so the comparison does not depend on the current scale.
        crop=cv2.resize(banded[1],(m['normSize'][0],m['normSize'][1]),interpolation=cv2.INTER_AREA)
        return (crop>m['whiteMin']).all(axis=2).astype(np.uint8)

    def state(self, white, m):
        # Dilated overlap against each registered lettering; tolerant of 1px shifts and noise.
        k=np.ones((5,5),np.uint8);best=(0.0,None)
        dil=cv2.dilate(white,k)
        for name,(sha,ref) in self.states.items():
            a=float((dil&ref).sum())/max(1,int(ref.sum()));b=float((cv2.dilate(ref,k)&white).sum())/max(1,int(white.sum()))
            score=min(a,b)
            if score>best[0]:best=(score,name)
        return best

    def title(self, image, viewport):
        """Best title match as {score, region(fraction of viewport)} or None below threshold."""
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'))
        src=self.p['dimensions']
        scale=w/src['width']
        if not .8<=scale<=1.25 or abs((w/h)/(src['width']/src['height'])-1)>.06:return None
        anchor=self.p['anchors'][0];search=anchor['search']
        left=x+round(search['x']*w);top=y+round(search['y']*h)
        crop=image[top:top+round(search['height']*h),left:left+round(search['width']*w)]
        best=None
        for factor in self.p['scales']:
            s=scale*factor
            t=cv2.resize(self.templates['title'],None,fx=s,fy=s,interpolation=cv2.INTER_LINEAR)
            th,tw=t.shape[:2]
            if th>crop.shape[0] or tw>crop.shape[1]:continue
            _,score,_,pt=cv2.minMaxLoc(cv2.matchTemplate(crop,t,cv2.TM_CCOEFF_NORMED))
            if np.isfinite(score) and (best is None or score>best['score']):
                best=dict(score=float(score),region=dict(x=(left+pt[0]-x)/w,y=(top+pt[1]-y)/h,width=tw/w,height=th/h))
        return best

    def detect(self, image, viewport, roi=None):
        """roi(im, box) -> popup fields (box, region, hash, image). Returns None without the title."""
        best=self.title(image,viewport)
        if best is None or best['score']<self.p['threshold']:return None
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'))
        m=self.p['textMask']
        b,crop=self.band(image,viewport)
        white=(crop>m['whiteMin']).all(axis=2)
        count=int(white.sum())
        anchors=dict(title=best)
        info=dict(detected=True,unit='fraction',space='game',anchors=anchors,whitePixels=count)
        if count<m['minWhitePixelsFraction']*w*h:
            info['textVisible']=False
            return {'scene':'unknown','townCards':info,'popupCandidates':[]}
        info['textVisible']=True
        # The state label (OPEN / CLAIM) is the context: stable against shimmer and 1px jitter.
        norm=self.mask((b,crop),m)
        score,name=self.state(norm,m)
        if name and score>=m['stateMatchMin']:
            ctx=hashlib.sha256(('town_cards:'+name+':'+self.states[name][0]).encode()).hexdigest();info['state']=name
        else:
            small=cv2.resize(norm*255,tuple(m['hashSize']),interpolation=cv2.INTER_AREA)
            ctx=hashlib.sha256(b'town_cards:other:'+(small>96).astype(np.uint8).tobytes()).hexdigest();info['state']='other'
        info['stateScore']=score
        popup={'kind':'town_cards',**roi(image,b),'contextHash':ctx}
        return {'scene':'unknown','townCards':info,'popupCandidates':[],'popup':popup}
