"""Dealer controls from current panel geometry and original game crops. No OCR."""
import base64,hashlib,json
from pathlib import Path
import cv2,numpy as np

def rect(x,y,w,h):return dict(x=int(round(x)),y=int(round(y)),width=int(round(w)),height=int(round(h)))
def crop(im,b):return im[b['y']:b['y']+b['height'],b['x']:b['x']+b['width']]
def relative(panel,r):return rect(panel['x']+r[0]*panel['width'],panel['y']+r[1]*panel['height'],r[2]*panel['width'],r[3]*panel['height'])
def inside(b,p):return b['width']>0 and b['height']>0 and b['x']>=p['x'] and b['y']>=p['y'] and b['x']+b['width']<=p['x']+p['width'] and b['y']+b['height']<=p['y']+p['height']

class Dealer:
    def __init__(self,path):
        path=Path(path);self.profile_bytes=path.read_bytes();self.p=json.loads(self.profile_bytes);self.templates={}
        for role,a in self.p['assets'].items():
            raw=(path.parent/a['file']).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=a['sha256']:raise ValueError('DEALER_ASSET_CHANGED')
            self.templates[role]=cv2.imdecode(np.frombuffer(raw,np.uint8),1)

    def match(self,im,role,area,scale):
        pixels=crop(im,area);best=None
        for factor in [.94,.97,1,1.03,1.06]:
            t=cv2.resize(self.templates[role],None,fx=scale*factor,fy=scale*factor)
            if pixels.shape[0]<t.shape[0] or pixels.shape[1]<t.shape[1]:continue
            _,value,_,at=cv2.minMaxLoc(cv2.matchTemplate(pixels,t,cv2.TM_CCOEFF_NORMED))
            if value>=.88 and (best is None or value>best[0]):best=(value,rect(area['x']+at[0],area['y']+at[1],t.shape[1],t.shape[0]))
        return best[1] if best else None

    def buttons(self,im,area,blue=False):
        hsv=cv2.cvtColor(crop(im,area),cv2.COLOR_BGR2HSV)
        lo,hi=(85,125) if blue else (35,90)
        mask=((hsv[:,:,0]>lo)&(hsv[:,:,0]<hi)&(hsv[:,:,1]>160)&(hsv[:,:,2]>120)).astype(np.uint8)*255
        mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        found=[]
        for c in cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            x,y,w,h=cv2.boundingRect(c)
            if w>area['width']*.15 and h>area['height']*.07 and 1.8<w/h<5:
                found.append(rect(area['x']+x,area['y']+y,w,h))
        return sorted(found,key=lambda b:b['width']*b['height'],reverse=True)

    def entry(self,im,viewport,view):
        # The observed market grid supplies the right edge of the dealer area.
        area=rect(viewport['x'],viewport['y'],view['x']-viewport['x'],viewport['height'])
        if not inside(area,viewport):return None
        buttons=self.buttons(im,relative(area,(0,.4,1,.6)),blue=True)
        if not buttons:return None
        b=buttons[0];pixels=crop(im,b)
        return dict(box=b,region={k:b[k]/im.shape[1 if k in ('x','width') else 0] for k in b},
            hash=hashlib.sha256(pixels.tobytes()).hexdigest(),image='data:image/png;base64,'+base64.b64encode(cv2.imencode('.png',pixels)[1]).decode())

    def panel(self,im,viewport):
        pixels=crop(im,viewport);b,g,r=[pixels[:,:,i].astype(np.int16) for i in range(3)]
        mask=((r>205)&(g>175)&(b>105)&(r>=g)&(g>=b)).astype(np.uint8)*255
        mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
        candidates=[]
        for c in cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            x,y,w,h=cv2.boundingRect(c)
            if w>viewport['width']*.5 and h>viewport['height']*.55:candidates.append(rect(viewport['x']+x,viewport['y']+y,w,h))
        for measured in sorted(candidates,key=lambda p:-p['width']*p['height']):
            for kind in ('search','offers'):
                source=self.p['panels'][kind];d=self.p['sources'][source['source']]['dimensions'];r=source['region']
                sw,sh=r['width']*d['width'],r['height']*d['height']
                # The offers speech tail touches the dealer's shirt; its height
                # remains intact. The search panel's full width is observable.
                scale=measured['width']/sw if kind=='search' else measured['height']/sh
                if not .4<=scale<=1.6:continue
                title=self.match(im,kind+'_title',relative(measured,(0,0,1,.25)),scale)
                if not title:continue
                a=self.p['assets'][kind+'_title']['region'];scale=title['width']/self.templates[kind+'_title'].shape[1]
                panel=rect(title['x']-(a['x']-r['x'])*d['width']*scale,title['y']-(a['y']-r['y'])*d['height']*scale,sw*scale,sh*scale)
                if not inside(panel,viewport):panel=measured
                return kind,panel,scale
        return None

    def close(self,im,panel):
        area=relative(panel,(.88,0,.12,.16));hsv=cv2.cvtColor(crop(im,area),cv2.COLOR_BGR2HSV)
        mask=((hsv[:,:,0]<25)&(hsv[:,:,1]>85)&(hsv[:,:,2]>130)).astype(np.uint8)*255
        found=[]
        for c in cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            x,y,w,h=cv2.boundingRect(c)
            if .7<w/h<1.4 and panel['width']*.02<w<panel['width']*.07:found.append(rect(area['x']+x,area['y']+y,w,h))
        return found[0] if len(found)==1 else None

    def analyze(self,im,viewport):
        located=self.panel(im,viewport)
        if not located:return None
        kind,panel,scale=located;result=dict(scene='dealer_'+kind,close=self.close(im,panel),dealer={})
        d=result['dealer']
        if kind=='search':
            tab=relative(panel,(.68,.12,.19,.13));icon=self.match(im,'mining',tab,scale)
            d['tab']=icon
            sample=crop(im,relative(tab,(.1,.15,.8,.12)))
            d['miningActive']=bool(icon is not None and np.mean(sample[:,:,0])>180)
            d['pickaxe']=self.match(im,'pickaxe_list',relative(panel,(.03,.27,.69,.59)),scale) if d['miningActive'] else None
            d['selectedPickaxe']=self.match(im,'pickaxe_selected',relative(panel,(.76,.35,.20,.3)),scale) is not None
            buttons=self.buttons(im,relative(panel,(.75,.67,.23,.20)))
            d['search']=buttons[0] if d['selectedPickaxe'] and len(buttons)==1 else None
        else:
            third=relative(panel,(.66,.27,.29,.5))
            pickaxe=self.match(im,'pickaxe_offer',third,scale)
            buttons=self.buttons(im,relative(third,(0,.60,1,.40)))
            button=buttons[0] if len(buttons)==1 else None
            d['buy']=button if pickaxe and button and self.match(im,'coin',button,scale) else None
        return result
