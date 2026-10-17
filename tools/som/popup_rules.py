"""[사용자 변경 2026-10-14] 안내 화살표(arrow_guide) / 이벤트 창 X(event_close) / CONTINUE 버튼(continue) 인식기.
모든 위치는 현재 게임 화면에 대한 비율이며, 실제 픽셀은 이 경계에서만 계산한다."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np


def _yellow(im):
    hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV)
    return (((hsv[...,0]>=18)&(hsv[...,0]<=32)&(hsv[...,1]>150)&(hsv[...,2]>200))*255).astype(np.uint8)


class PopupRuleDetector:
    def __init__(self, path):
        path=Path(path)
        self.profile_bytes=path.read_bytes()
        self.p=json.loads(self.profile_bytes)
        self.kind=self.p['kind']
        self.templates={}
        for a in self.p['anchors']:
            data=(path.parent/a['file']).read_bytes()
            if hashlib.sha256(data).hexdigest()!=a['sha256']:raise ValueError('POPUP_RULE_ASSET_CHANGED')
            t=cv2.imdecode(np.frombuffer(data,np.uint8),1)
            self.templates[a['role']]=_yellow(t) if a['mode']=='yellowMask' else t

    def match(self, image, viewport, anchor):
        """Best match of one anchor: {score, box(px)} or None. Search area is a fraction of the viewport."""
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'))
        src=self.p['dimensions'];scale=w/src['width']
        if not .8<=scale<=1.25 or abs((w/h)/(src['width']/src['height'])-1)>.06:return None
        s=anchor['search'];left=x+round(s['x']*w);top=y+round(s['y']*h)
        crop=image[top:top+round(s['height']*h),left:left+round(s['width']*w)]
        if anchor['mode']=='yellowMask':crop=_yellow(crop)
        # Coarse-to-fast: match at half resolution (speed); positions are mapped back to full pixels.
        ms=anchor.get('matchScale',self.p.get('matchScale',.5))
        small=cv2.resize(crop,None,fx=ms,fy=ms,interpolation=cv2.INTER_AREA)
        best=None
        for f in self.p['scales']:
            tf=cv2.resize(self.templates[anchor['role']],None,fx=scale*f,fy=scale*f,interpolation=cv2.INTER_LINEAR)
            t=cv2.resize(tf,None,fx=ms,fy=ms,interpolation=cv2.INTER_AREA)
            if t.shape[0]>small.shape[0] or t.shape[1]>small.shape[1]:continue
            _,score,_,pt=cv2.minMaxLoc(cv2.matchTemplate(small,t,cv2.TM_CCOEFF_NORMED))
            if np.isfinite(score) and (best is None or score>best['score']):
                best=dict(score=float(score),box=dict(x=left+round(pt[0]/ms),y=top+round(pt[1]/ms),width=tf.shape[1],height=tf.shape[0]))
        return best

    def locate_icon(self, image, viewport, ab):
        """Icon the (left-pointing) arrow points at: the nearest lit (undimmed) blob left of the arrow tip.
        The overlay dims everything except the target, so the target is the bright component."""
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'));t=self.p['target']
        y0=max(y,ab['y']-round(t['bandMargin']*h));y1=min(y+h,ab['y']+ab['height']+round(t['bandMargin']*h))
        x1=ab['x']+round(.3*ab['width'])
        if x1<=x or y1<=y0:return None
        v=cv2.cvtColor(image[y0:y1,x:x1],cv2.COLOR_BGR2HSV)[...,2]
        m=cv2.morphologyEx((v>t['litValueMin']).astype(np.uint8),cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
        n,_,st,_=cv2.connectedComponentsWithStats(m)
        best=None;area=t['minAreaFraction']*w*h
        for i in range(1,n):
            cx,cy,cw,ch,a=st[i]
            if a<area:continue
            gap=ab['x']-(x+cx+cw)
            if best is None or gap<best[0]:best=(gap,dict(x=x+int(cx),y=y0+int(cy),width=int(cw),height=int(ch)))
        if best is None:return None
        b=best[1];wf,hf=b['width']/w,b['height']/h
        if not t['sizeFraction']['min'][0]<=wf<=t['sizeFraction']['max'][0] or not t['sizeFraction']['min'][1]<=hf<=t['sizeFraction']['max'][1]:return None
        if best[0]>t['maxGapFraction']*w:return None
        return b

    def locate_toward(self, image, viewport, ab, direction):
        """[2026-10-17] 위·오른쪽·아래 화살표: 가리키는 쪽 띠에서 화살표(노란색)를 뺀 밝은 덩어리 중 가장 가까운 것."""
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'));t=self.p['target']
        mx,my=round(t['bandMargin']*w),round(t['bandMargin']*h)
        if direction=='up':x0,x1,y0,y1=ab['x']-mx,ab['x']+ab['width']+mx,y,ab['y']+round(.3*ab['height'])
        elif direction=='down':x0,x1,y0,y1=ab['x']-mx,ab['x']+ab['width']+mx,ab['y']+round(.7*ab['height']),y+h
        elif direction=='left':x0,x1,y0,y1=x,ab['x']+round(.3*ab['width']),ab['y']-my,ab['y']+ab['height']+my
        else:x0,x1,y0,y1=ab['x']+round(.7*ab['width']),x+w,ab['y']-my,ab['y']+ab['height']+my
        x0,x1,y0,y1=max(x,x0),min(x+w,x1),max(y,y0),min(y+h,y1)
        if x1<=x0 or y1<=y0:return None
        crop=image[y0:y1,x0:x1];v=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV)[...,2]
        lit=((v>t['litValueMin'])&(_yellow(crop)==0)).astype(np.uint8)
        m=cv2.morphologyEx(lit,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
        n,_,st,_=cv2.connectedComponentsWithStats(m)
        best=None;area=t['minAreaFraction']*w*h
        for i in range(1,n):
            cx,cy,cw,ch,a=st[i]
            if a<area or cw>.3*w or ch>.45*h:continue
            bx,by=x0+int(cx),y0+int(cy)
            gap=ab['y']-(by+ch) if direction=='up' else by-(ab['y']+ab['height']) if direction=='down' else ab['x']-(bx+cw) if direction=='left' else bx-(ab['x']+ab['width'])
            if gap<-.3*max(ab['width'],ab['height']):continue
            if best is None or gap<best[0]:best=(gap,dict(x=bx,y=by,width=int(cw),height=int(ch)))
        if best is None or best[0]>t['maxGapFraction']*w:return None
        return best[1]

    def detect(self, image, viewport, roi=None):
        """roi(im, box) -> popup fields. Returns {'scene':'unknown', kind:info, 'popup':{...}} or None."""
        x,y,w,h=(viewport[k] for k in ('x','y','width','height'))
        found={}
        if self.kind=='arrow_guide':
            # [사용자 변경 2026-10-17] 화면이 어두워지고 일부만 밝아지는 안내는 밝은 부분을 눌러야 끝난다(사용자).
            # 화살표 4방향(왼·위·오른·아래)을 모두 찾아, 가리키는 쪽의 가장 가까운 밝은 부분을 누른다.
            # 안내가 끝나 화면이 밝아지면 이벤트 닫기(빨간 X) 규칙이 X를 누른다.
            if image[y:y+h,x:x+w].mean()>self.p['darkMeanMax']:return None
            a=self.p['anchors'][0];best=None
            for k,d in ((0,'left'),(3,'up'),(2,'right'),(1,'down')):
                self.templates.setdefault('arrow@'+d,np.ascontiguousarray(np.rot90(self.templates[a['role']],k)))
                m=self.match(image,viewport,{**a,'role':'arrow@'+d})
                if m is not None and m['score']>=a['threshold'] and (best is None or m['score']>best[0]['score']):best=(m,d)
            if best is None:return None
            found['arrow']=best[0]
            b=(self.locate_icon(image,viewport,found['arrow']['box']) or self.locate_toward(image,viewport,found['arrow']['box'],'left')) if best[1]=='left' else self.locate_toward(image,viewport,found['arrow']['box'],best[1])
            if b is None:
                # 대상이 화살표 끝에 걸친 긴 막대 등이면 밝은 덩어리로 안 잡힌다 → 화살표 끝 바로 앞(20px)을 누른다.
                ab=found['arrow']['box'];cx,cy=ab['x']+ab['width']//2,ab['y']+ab['height']//2
                tx,ty={'left':(ab['x']-20,cy),'right':(ab['x']+ab['width']+20,cy),'up':(cx,ab['y']-20),'down':(cx,ab['y']+ab['height']+20)}[best[1]]
                b=dict(x=tx-15,y=ty-15,width=30,height=30)
            ctx=hashlib.sha256((self.kind+':'+self.p['version']+':'+best[1]).encode()).hexdigest()
            b['x']=max(x,min(b['x'],x+w-1));b['y']=max(y,min(b['y'],y+h-1))
            b['width']=max(1,min(b['width'],x+w-b['x']));b['height']=max(1,min(b['height'],y+h-b['y']))
            info=dict(detected=True,unit='fraction',space='game',direction=best[1],scores={'arrow':best[0]['score']})
            return {'scene':'unknown',self.kind:info,'popupCandidates':[],'popup':{'kind':self.kind,**roi(image,b),'contextHash':ctx}}
        for a in self.p['anchors']:
            m=self.match(image,viewport,a)
            if m is None or m['score']<a['threshold']:return None
            found[a['role']]=m
        if self.kind=='arrow_guide':
            b=self.locate_icon(image,viewport,found['arrow']['box'])
            if b is None:return None
        elif self.kind=='continue':
            t=self.p['target'];cb=found['continue']['box']
            b=dict(x=cb['x']+round(t['dx']*w),y=cb['y']+round(t['dy']*h),width=round(t['width']*w),height=round(t['height']*h))
        else:b=dict(found['close']['box'])
        # keep the tap box inside the game viewport
        b['x']=max(x,min(b['x'],x+w-1));b['y']=max(y,min(b['y'],y+h-1))
        b['width']=max(1,min(b['width'],x+w-b['x']));b['height']=max(1,min(b['height'],y+h-b['y']))
        ctx=hashlib.sha256((self.kind+':'+self.p['version']+':'+self.p['anchors'][0]['sha256']).encode()).hexdigest()
        info=dict(detected=True,unit='fraction',space='game',scores={k:v['score'] for k,v in found.items()})
        popup={'kind':self.kind,**roi(image,b),'contextHash':ctx}
        return {'scene':'unknown',self.kind:info,'popupCandidates':[],'popup':popup}
