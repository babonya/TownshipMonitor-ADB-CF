"""Actual screenshot-only barn inspection. Translation is measured, never resized."""
import json,hashlib
from pathlib import Path
import cv2,numpy as np
from percentage_profile import resolve_percentage_profile

def digest(raw):return hashlib.sha256(raw).hexdigest()
def crop(im,b):return im[b['y']:b['y']+b['height'],b['x']:b['x']+b['width']]
def shifted(b,x,y):return {**b,'x':b['x']+x,'y':b['y']+y}
def score(im,t):
    if im.shape[0]<t.shape[0] or im.shape[1]<t.shape[1]:return (-1,None)
    a=cv2.matchTemplate(im,t,cv2.TM_CCOEFF_NORMED);_,v,_,p=cv2.minMaxLoc(a)
    return (float(v),p)

class BarnSaleAnalyzer:
    def __init__(self,path=None):
        self.path=path or Path(__file__).resolve().parents[2]/'reference/barn-sale/profile.json'
        self.path=Path(self.path);raw=self.path.read_bytes();self.hash=digest(raw)
        self.p=resolve_percentage_profile(json.loads(raw));self.assets={}
        def visit(v):
            if isinstance(v,dict):
                if 'file' in v and 'source' in v:
                    data=(self.path.parent/v['file']).read_bytes();s=v['source'];original=(self.path.parent/s['file']).read_bytes()
                    if digest(data)!=v['sha256'] or digest(original)!=s['sha256']:raise ValueError('BARN_ASSET_CHANGED')
                    a=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR);o=cv2.imdecode(np.frombuffer(original,np.uint8),cv2.IMREAD_COLOR)
                    if not np.array_equal(a,crop(o,s['cropBox'])):raise ValueError('BARN_CROP_CHANGED')
                    self.assets[v['file']]=a
                for child in v.values():visit(child)
            elif isinstance(v,list):
                for child in v:visit(child)
        visit(self.p)
    def analyze(self,im):
        p=self.p;panel=p['panel'];anchors=p['anchors'];h,w=im.shape[:2]
        out={'profileHash':self.hash,'supported':False,'rows':[],'selected':None}
        v,at=score(im,self.assets[anchors['title']['file']])
        if v<.985:return out
        x,y=at[0]-panel['title']['x'],at[1]-panel['title']['y'];d=panel['dimensions']
        if x<0 or y<0 or x+d['width']>w or y+d['height']>h:return out
        def exact(spec,b):
            return score(crop(im,b),self.assets[spec['file']])[0]>=.985
        if not exact(anchors['close'],shifted(panel['close'],x,y)):return out
        # Independent bottom anchor prevents a title or isolated close from identifying a panel.
        bottom=anchors['bottom'];b=shifted(panel['bottom'],x,y)
        if not exact(bottom,b):return out
        out.update(panelBox={'x':x,'y':y,**d},titleBox=shifted(panel['title'],x,y),closeBox=shifted(panel['close'],x,y),
                   capacityBox=shifted(panel['capacity'],x,y),gridBox=shifted(panel['grid'],x,y))
        out['tabs']=[]
        for tab in p['tabs']:
            search=shifted(tab['searchBox'],x,y);found=[]
            for state in ['active','inactive']:
                t=self.assets[tab[state]['file']];value,pos=score(crop(im,search),t)
                b={'x':search['x']+pos[0],'y':search['y']+pos[1],'width':t.shape[1],'height':t.shape[0]} if pos else None
                if value>=.985 and np.abs(crop(im,b).astype(float)-t).mean()<=4:found.append((state,b))
            out['tabs'].append({'id':tab['id'],'box':shifted(tab['box'],x,y),'state':found[0][0] if len(found)==1 else 'unknown','matchBox':found[0][1] if len(found)==1 else None})
        active=[t['id'] for t in out['tabs'] if t['state']=='active']
        out['activeTab']=active[0] if len(active)==1 else ('all' if not active and exact(anchors['allTab'],shifted(panel['allTab'],x,y)) else None)
        sel=p['selection'];sv,sp=score(im,self.assets[sel['titleTemplate']['file']])
        if sv>=.985:
            sx,sy=sp[0]-sel['title']['x'],sp[1]-sel['title']['y'];pb=shifted(sel['popup'],sx,sy)
            if sx<0 or sy<0 or sx+pb['width']>w or sy+pb['height']>h:return out
            if not all(exact(sel[k+'Template'],shifted(sel[k],sx,sy)) for k in ['minus','plus']):return out
            for name,region in [('sellTemplate','sellLabel'),('coinTemplate','coin')]:
                s=sel[name];position=shifted(sel[region],sx,sy)
                if not exact(s,position):return out
            out['selected']={'itemId':'donut','name':'Donut','category':'factory_product','popupBox':pb,
                'quantityBox':shifted(sel['quantity'],sx,sy),'sellBox':shifted(sel['sell'],sx,sy),'titleBox':shifted(sel['title'],sx,sy)}
        elif not exact(anchors['plainStrip'],shifted(panel['plainStrip'],x,y)) or out['activeTab'] is None:return out
        for row in panel['rows']:
            ib=shifted(row['iconBox'],x,y);qb=shifted(row['quantityBox'],x,y)
            matches=[]
            for product in p['products']:
                value,where=score(crop(im,ib),self.assets[product['template']['file']])
                if value>=product['minScore']:matches.append((value,product,where))
            product=matches[0][1] if len(matches)==1 else None
            out['rows'].append({'index':row['index'],'iconBox':ib,'quantityBox':qb,'itemId':product['itemId'] if product else None,
                'category':product['category'] if product else None,'identityConfirmed':product is not None,
                'matchBox':({'x':ib['x']+matches[0][2][0],'y':ib['y']+matches[0][2][1],'width':self.assets[product['template']['file']].shape[1],'height':self.assets[product['template']['file']].shape[0]} if product else None)})
        out['supported']=True
        return out
