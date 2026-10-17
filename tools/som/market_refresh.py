"""Read only the registered NEW OFFERS IN timer; never a paid refresh target."""
import hashlib,json
from pathlib import Path
import cv2,numpy as np
from percentage_profile import resolve_percentage_profile

class MarketRefresh:
    def __init__(self,root):
        self.root=Path(root)/'market-recognition'
        self.profile_bytes=(self.root/'profile.json').read_bytes()
        self.profile=resolve_percentage_profile(json.loads(self.profile_bytes))
        self.cache={}

    def read(self,im,get_ocr):
        height,width=im.shape[:2]
        layout=next((l for l in self.profile['layouts'] if l['dimensions']==dict(width=width,height=height)),None)
        if not layout:return None
        caption=layout.get('refreshCaption');timer=layout.get('refreshTimerBox')
        if not caption or not timer:return None
        data=(self.root/caption['file']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=caption['sha256']:return None
        template=cv2.imdecode(np.frombuffer(data,np.uint8),1)
        def crop(b):return im[b['y']:b['y']+b['height'],b['x']:b['x']+b['width']]
        actual=crop(caption['box'])
        if actual.shape!=template.shape or not float(cv2.matchTemplate(actual,template,cv2.TM_CCOEFF_NORMED)[0,0])>=.96:return None
        pixels=crop(timer);key=hashlib.sha256(pixels.tobytes()).hexdigest()
        if key not in self.cache:
            ocr=get_ocr();field={'fieldId':'market-free-refresh','kind':'text','box':timer,'scale':3,'minimumScore':.82}
            reading=ocr.recognize_region(im,field)
            if len(self.cache)>=64:self.cache.pop(next(iter(self.cache)))
            self.cache[key]={k:reading[k] for k in ('rawText','ocrScores')}
        return {'captionVerified':True,'cropHash':key,'region':{k:timer[k]/(width if k in ('x','width') else height) for k in timer},
                **self.cache[key]}
