"""UI geometry, product crops and bounded barn-sale verification. No input API."""
import sys, json, base64, hashlib
from pathlib import Path
import cv2
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'township-perception'))
from percentage_profile import resolve_percentage_profile
from minigame import MinigameDetector
from dealer import Dealer
from barn_full import BarnFullDetector
from products_missing import ProductsMissingDetector
from barn import SomBarn
from order_buttons import OrderButtons
from market_geometry import market_gap_geometry
from market_refresh import MarketRefresh
from market_coverage import MarketCoverage,visible_sold_coverage

def digest(b): return hashlib.sha256(b).hexdigest()
def box(f,w,h): return {k:round(f[k]*(w if k in ('x','width') else h)) for k in ('x','y','width','height')}
def cut(im,b): return im[b['y']:b['y']+b['height'],b['x']:b['x']+b['width']]
def bounds(x,y,w,h): return dict(x=int(x),y=int(y),width=int(w),height=int(h))
def encoded(im): return 'data:image/png;base64,'+base64.b64encode(cv2.imencode('.png',im)[1]).decode()
def fraction(b,w,h): return {k:b[k]/(w if k in ('x','width') else h) for k in b}

class Vision:
    def __init__(self,path):
        self.root=Path(path).parent; raw=Path(path).read_bytes(); self.p=resolve_percentage_profile(json.loads(raw))
        self.minigame=MinigameDetector(self.root/'minigame/profile.json')
        self.barn_full=BarnFullDetector(self.root/'barn-full/profile.json')
        self.products_missing=ProductsMissingDetector(self.root/'products-missing/profile.json')
        self.barn=SomBarn(self.root.parent);self.timer_ocr=None
        self.order_buttons=OrderButtons(Path(__file__).parent/'order-refresh/profile.json')
        self.market_refresh=MarketRefresh(self.root.parent)
        self.market_coverage=MarketCoverage()
        self.dealer=Dealer(self.root/'dealer/profile.json')
        self.hash=digest(raw+self.dealer.profile_bytes+self.products_missing.profile_bytes+self.order_buttons.profile_bytes+self.minigame.profile_bytes+self.barn_full.profile_bytes+self.barn.profile_bytes+self.market_refresh.profile_bytes); self.templates={}
        for a in self.p['assets']:
            data=(self.root/a['file']).read_bytes()
            if digest(data)!=a['sha256']: raise ValueError('SOM_UI_ASSET_CHANGED')
            self.templates[a['file']]=cv2.imdecode(np.frombuffer(data,np.uint8),1)
    def get_timer_ocr(self):
        if self.timer_ocr is None:
            from ocr import OcrEngine
            self.timer_ocr=OcrEngine()
        return self.timer_ocr
    def locate(self,im,spec,search=None,threshold=.96,multiple=False,scored=False):
        height,width=im.shape[:2]; b=search or box(spec['search'],width,height); crop=cut(im,b); t=self.templates[spec['file']]
        if crop.shape[0]<t.shape[0] or crop.shape[1]<t.shape[1]: return []
        mask=None
        if spec.get('maskExclude'):
            mask=np.full(t.shape[:2],255,np.uint8)
            for f in spec['maskExclude']:
                z=box(f,t.shape[1],t.shape[0]); mask[z['y']:z['y']+z['height'],z['x']:z['x']+z['width']]=0
        scores=cv2.matchTemplate(crop,t,cv2.TM_CCOEFF_NORMED,mask=mask)
        scores=np.nan_to_num(scores,nan=-1,posinf=-1,neginf=-1); hits=[]
        for _ in range(24 if multiple else 1):
            _,score,_,(x,y)=cv2.minMaxLoc(scores)
            if score<threshold: break
            hits.append((bounds(x+b['x'],y+b['y'],t.shape[1],t.shape[0]),score) if scored else bounds(x+b['x'],y+b['y'],t.shape[1],t.shape[0]))
            scores[max(0,y-20):y+21,max(0,x-20):x+21]=-1
        return hits
    def roi(self,im,b):
        crop=cut(im,b)
        return {'box':b,'region':fraction(b,im.shape[1],im.shape[0]),'hash':digest(crop.tobytes()),'image':encoded(crop)}
    def quantity(self,im,b,product):
        result=self.roi(im,b); key=result['hash']; crop=cut(im,b)
        # Empty slots have flat cream in both the product and amount regions.
        # An unread/covered amount beside an actual product is never empty.
        def empty(region):
            return (np.ptp(region.astype(np.int16),axis=(0,1)).max()<=2 and
                    np.all(region.min(axis=(0,1))>=np.array([200,230,240])))
        if empty(crop) and empty(cut(im,product['box'])):
            reading={'status':'empty','value':None,'rawText':'','ocrScores':[],'reason':None}
        else:
            if not hasattr(self,'quantity_cache'):self.quantity_cache={}
            if key not in self.quantity_cache:
                field={'fieldId':'quantity','kind':'stock_pair','box':b,'scale':2,'minimumScore':.9}
                value=self.get_timer_ocr().recognize_region(im,field)
                if value['status']!='parsed_candidate':
                    # Green check edges can add a spurious glyph. Retry OCR
                    # once on brown/red number strokes from the same crop.
                    # Colour alone never decides stock sufficiency.
                    blue,green,red=cv2.split(crop.astype(np.int16))
                    ink=(red>green+30)&(red>blue+30)
                    text=np.repeat(np.where(ink[:,:,None],0,255).astype(np.uint8),3,axis=2)
                    text=cv2.copyMakeBorder(text,5,5,5,5,cv2.BORDER_CONSTANT,value=(255,255,255))
                    height,width=text.shape[:2]
                    field={**field,'box':bounds(0,0,width,height)}
                    value=self.get_timer_ocr().recognize_region(text,field)
                if len(self.quantity_cache)>=256:self.quantity_cache.pop(next(iter(self.quantity_cache)))
                self.quantity_cache[key]={k:value[k] for k in ('status','value','rawText','ocrScores','reason')}
            reading=self.quantity_cache[key]
        result['reading']={'quantityHash':key,'productHash':product['hash'],**reading}
        return result

    def town_market_target(self,viewport):
        return self.town_target(viewport,'market')
    def town_target(self,viewport,facility):
        # The user keeps this town layout fixed. Town recognition, not a
        # separate building-template match, authorizes this configured point.
        p=self.p['town'].get(facility+'Tap',{})
        if p.get('unit')!='fraction' or p.get('space')!='game' or any(
                type(p.get(k)) not in (int,float) or not np.isfinite(p[k]) or not 0<=p[k]<1 for k in ('x','y')):
            raise ValueError(f'SOM_{facility.upper()}_PERCENTAGE_REQUIRED')
        x=viewport['x']+round(p['x']*viewport['width']); y=viewport['y']+round(p['y']*viewport['height'])
        if not (viewport['x']<=x-1 and x+1<=viewport['x']+viewport['width'] and
                viewport['y']<=y-1 and y+1<=viewport['y']+viewport['height']):
            raise ValueError(f'SOM_{facility.upper()}_TARGET_OUTSIDE_VIEWPORT')
        return bounds(x-1,y-1,2,2)
    def selected(self,im,pin,support=None):
        p=self.p['selection']; H,W=im.shape[:2]; cw=round(p['cropFraction']['width']*W); ch=round(p['cropFraction']['height']*H)
        b=pin['box']; x=round(b['x']+b['width']/2-p['pinAnchor']['x']*cw); y=round(b['y']+b['height']/2-p['pinAnchor']['y']*ch)
        if x<0 or y<0 or x+cw>W or y+ch>H:return False
        c=p['color']; s=p['support'] if support is None else support; crop=im[y:y+ch,x:x+cw].astype(np.int16)
        for f in p['bands']:
            z=cut(crop,box(f,cw,ch)); blue,g,r=z[:,:,0],z[:,:,1],z[:,:,2]
            hits=((r>c['redAbove'])&(g>c['greenAbove'])&(blue>c['blueAbove'])&(r-blue>c['redMinusBlueAbove'])).sum(axis=1)
            rows=hits>=s['minimumPixelsPerRow']; run=best=0
            for hit in rows: run=run+1 if hit else 0; best=max(best,run)
            thirds=[int(part.sum()) for part in np.array_split(rows,3)]
            if hits.sum()<s['minimumPixels'] or rows.sum()<s['minimumRows'] or best<s['minimumRun'] or sum(v>=s['minimumThirdRows'] for v in thirds)<s['minimumThirds']:return False
        return True
    def helicopter(self,im):
        H,W=im.shape[:2]; p=self.p['heli']; m=box(p['map'],W,H); crop=cut(im,m); hsv=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV)
        vivid=(hsv[:,:,1]>170)&(hsv[:,:,2]>215); pins=[]; merged=[]
        for color,mask in [('green',vivid&(hsv[:,:,0]>=35)&(hsv[:,:,0]<=85)),('red',vivid&((hsv[:,:,0]<15)|(hsv[:,:,0]>170)))]:
            for c in cv2.findContours(mask.astype(np.uint8)*255,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
                x,y,w,h=cv2.boundingRect(c); area=cv2.contourArea(c)
                if 128<w<=280 and 80<h<=250 and 1200<=area<=8300:
                    # Overlapping borders may form one component. Locate each
                    # visible narrowing tip on its lower contour, without faces.
                    local=np.zeros((h,w),np.uint8);cv2.drawContours(local,[c-np.array([[[x,y]]])],-1,255,-1)
                    merged.append((color,x+m['x'],y+m['y'],local))
                    bottom=np.array([np.where(local[:,i]>0)[0].max() if local[:,i].any() else 0 for i in range(w)])
                    last=-100
                    for i in range(12,w-12):
                        if i-last<25 or bottom[i]<max(bottom[i-10:i+11]) or bottom[i]-min(bottom[max(0,i-45):i])<12 or bottom[i]-min(bottom[i+1:min(w,i+46)])<12:continue
                        last=i;tx=m['x']+x+i;ty=m['y']+y+int(bottom[i])-6
                        pin={'id':f'{round(tx/12)}:{round(ty/12)}','color':color,'box':bounds(tx-5,ty-5,10,10),'visualBox':bounds(tx-50,ty-100,100,110)}
                        pin['selected']=self.selected(im,pin);pins.append(pin)
                    continue
                if not (58<=w<=128 and (31 if color=='green' else 54)<=h<=155 and 690<=area<=4150):continue
                points=c[:,0,:]; bottom=points[points[:,1]>=y+h-8]
                if not len(bottom) or np.ptp(bottom[:,0])>w*.45:continue
                cx=int(np.median(bottom[:,0]))
                if not x+w*.2<cx<x+w*.8:continue
                tipx=m['x']+cx; tipy=m['y']+y+h-7
                b=bounds(tipx-5,tipy-5,10,10); pin={'id':f'{round(tipx/12)}:{round(tipy/12)}','color':color,'box':b,'visualBox':bounds(x+m['x'],y+m['y'],w,h)}
                pin['selected']=self.selected(im,pin); pins.append(pin)
        # [사용자 변경 2026-10-15] 초록 핀의 아래 끝은 어두운 초록(V 100~230)이라 vivid에서 빠지고 위 고리만 남아
        # 끝 판정에 실패한다(광부·경찰 핀). 잔디·나무(채도 180 이하)와 구분되는 채도 225 초과 초록으로 핀 전체를 다시 찾아,
        # 이미 찾은 핀이 들어 있지 않은 것만 더한다.
        deep=(hsv[:,:,1]>225)&(hsv[:,:,2]>90)&(hsv[:,:,0]>=35)&(hsv[:,:,0]<=85)
        for c in cv2.findContours(deep.astype(np.uint8)*255,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            x,y,w,h=cv2.boundingRect(c)
            if not (50<=w<=128 and 60<=h<=170 and cv2.contourArea(c)>=1000):continue
            vb=bounds(x+m['x'],y+m['y'],w,h)
            if any(vb['x']<=q['box']['x']+5<=vb['x']+w and vb['y']<=q['box']['y']+5<=vb['y']+h for q in pins if q['color']=='green'):continue
            points=c[:,0,:]; bottom=points[points[:,1]>=y+h-8]
            if not len(bottom) or np.ptp(bottom[:,0])>w*.45:continue
            cx=int(np.median(bottom[:,0]))
            if not x+w*.2<cx<x+w*.8:continue
            tipx=m['x']+cx; tipy=m['y']+y+h-12
            pin={'id':f'{round(tipx/12)}:{round(tipy/12)}','color':'green','box':bounds(tipx-5,tipy-5,10,10),'visualBox':vb}
            pin['selected']=self.selected(im,pin); pins.append(pin)
        # [사용자 변경 2026-10-15] 끝이 다른 핀에 가려지거나 얼굴·다른 핀 때문에 고리가 조각난 초록 핀(할머니·여자 핀).
        # 이미 찾은 초록 핀과 겹치지 않는 조각을 가까운 것끼리 묶고, 고리 모양에 원을 맞춰 얼굴 중심을 클릭점으로 쓴다.
        found=[q['visualBox'] for q in pins if q['color']=='green']
        pieces=[]
        for c in cv2.findContours(deep.astype(np.uint8)*255,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            a=cv2.contourArea(c); x,y,w,h=cv2.boundingRect(c); gx,gy=x+m['x'],y+m['y']
            if a<300 or any(gx<f['x']+f['width']+10 and f['x']<gx+w+10 and gy<f['y']+f['height']+10 and f['y']<gy+h+10 for f in found):continue
            pieces.append([gx,gy,gx+w,gy+h,a,c[:,0,:]+np.array([m['x'],m['y']])])
        groups=[]
        for piece in pieces:
            near_groups=[g for g in groups if any(piece[0]<q[2]+30 and q[0]<piece[2]+30 and piece[1]<q[3]+30 and q[1]<piece[3]+30 for q in g)]
            for g in near_groups:groups.remove(g)
            groups.append(sum(near_groups,[])+[piece])
        for g in groups:
            x1,y1=min(q[0] for q in g),min(q[1] for q in g);x2,y2=max(q[2] for q in g),max(q[3] for q in g)
            if not (45<=x2-x1<=128 and 45<=y2-y1<=170 and sum(q[4] for q in g)>=750):continue
            pts=np.vstack([q[5] for q in g]).astype(float)
            A=np.c_[2*pts,np.ones(len(pts))];sol=np.linalg.lstsq(A,(pts**2).sum(1),rcond=None)[0]
            cx,cy=sol[0],sol[1];r=np.sqrt(max(sol[2]+cx*cx+cy*cy,0))
            # 고리 바깥선과 안쪽선이 함께 들어가므로 잔차는 고리 두께 정도까지 허용한다.
            if not (25<=r<=55) or np.abs(np.hypot(pts[:,0]-cx,pts[:,1]-cy)-r).mean()>8:continue
            if not (m['x']<cx<m['x']+m['width'] and m['y']<cy<m['y']+m['height']):continue
            tx,ty=int(round(cx)),int(round(cy))
            pin={'id':f'{round(tx/12)}:{round(ty/12)}','color':'green','box':bounds(tx-5,ty-5,10,10),'visualBox':bounds(x1,y1,x2-x1,y2-y1)}
            pin['selected']=self.selected(im,pin); pins.append(pin)
        # The lower outline hides an upper marker's tip when borders touch.
        # Recover only an otherwise missing selected marker, using the existing
        # bilateral selection halo inside a recognized merged border component.
        if not any(pin['selected'] for pin in pins):
            # Preserve the original search first. Only an absent result tries
            # the observed partial bilateral halo of overlapping markers.
            # Colour, run, distribution, 2x2 support and uniqueness still apply.
            partial={**self.p['selection']['support'],'minimumPixels':40,'minimumRows':18}
            for overlap_support,max_spread in ((None,24),(partial,32)):
                recovered=[]
                for color,x,y,local in merged:
                    h,w=local.shape;hits=[]
                    for ty in range(y+40,y+h,4):
                        for tx in range(x,x+w,4):
                            if not local[ty-y,tx-x]:continue
                            pin={'box':bounds(tx-5,ty-5,10,10)}
                            if self.selected(im,pin,overlap_support):hits.append((tx,ty))
                    # Require a spatially supported halo cluster. Tiny isolated
                    # matches (for example beside a clock) are not marker evidence.
                    pending=set(hits)
                    while pending:
                        seed=pending.pop();cluster={seed};front=[seed]
                        while front:
                            px,py=front.pop()
                            for dx,dy in ((4,0),(-4,0),(0,4),(0,-4)):
                                q=(px+dx,py+dy)
                                if q in pending:pending.remove(q);cluster.add(q);front.append(q)
                        if not any({(tx+4,ty),(tx,ty+4),(tx+4,ty+4)}<=cluster for tx,ty in cluster):continue
                        if np.ptp(np.array(list(cluster)),axis=0).max()>max_spread:continue
                        tx,ty=np.rint(np.median(list(cluster),axis=0)).astype(int)
                        pin={'id':f'{round(tx/12)}:{round(ty/12)}','color':color,
                             'box':bounds(tx-5,ty-5,10,10),'visualBox':bounds(tx-50,ty-100,100,110)}
                        if self.selected(im,pin,overlap_support):pin['selected']=True;recovered.append(pin)
                if len(recovered)==1:
                    pin=recovered[0];b=pin['box']
                    pins=[q for q in pins if np.hypot(q['box']['x']-b['x'],q['box']['y']-b['y'])>=24]
                    pins.append(pin)
                if recovered:break
        send=box(p['send'],W,H); grid=box(p['orderGrid'],W,H)
        panel_left=m['x']+m['width']; panel=bounds(panel_left,grid['y'],W-panel_left,send['y']+send['height']-grid['y'])
        refreshing=self.order_buttons.refreshing(im,panel)
        slots=[]
        for s in ([] if refreshing else p['slots']):
            ib=box(s['icon'],W,H); qb=box(s['shortage'],W,H)
            product=self.roi(im,ib)
            slots.append({'id':s['id'],**product,'amount':self.quantity(im,qb,product)})
        send=box(p['send'],W,H); sh=cv2.cvtColor(cut(im,send),cv2.COLOR_BGR2HSV)
        ready=float(np.mean((sh[:,:,0]>=35)&(sh[:,:,0]<=85)&(sh[:,:,1]>140)&(sh[:,:,2]>140)))>.32
        ready=ready and not refreshing and self.order_buttons.matches('send',im,send)
        close=self.locate(im,p['close'])
        grid=box(p['orderGrid'],W,H)
        trash=self.locate(im,p['trash'],threshold=p['trash']['minimumScore']) if p.get('trash') else []
        return {'refreshing':refreshing,'trash':trash[0] if trash and not refreshing else None,'scene':'helicopter','pins':pins,'orderSlots':slots,'send':send if ready else None,'close':close[0] if close else None,
                'orderHash':digest(cut(im,grid).tobytes()),'orderBox':grid}
    def market_motion(self,im):
        H,W=im.shape[:2];view=box(self.p['market']['view'],W,H)
        return {'scene':'market','view':view,'descriptor':cv2.resize(cut(im,view),(40,20),interpolation=cv2.INTER_AREA).reshape(-1).tolist()}
    def market(self,im):
        H,W=im.shape[:2]; p=self.p['market']; view=box(p['view'],W,H); cw=round(p['cardSize']['width']*W); ch=round(p['cardSize']['height']*H)
        def marks(role,search=view):
            result=[]
            if role=='offer_structure' and search==view:
                # Observe border geometry just outside the nominal viewport.
                # Clipped cards remain excluded from cells and input targets.
                left=max(0,view['x']-3);right=min(W,view['x']+view['width']+3)
                search={**view,'x':left,'width':right-left}
            for s in p['markers']:
                if s['role']!=role:continue
                # [2026-10-20 속도] 카드 테두리·SOLD 표시는 아래에서 '두 줄 높이(profile market.rows) ±3px'인 것만 카드로 받아들인다.
                # 그러니 시장 영역 전체(세로 약 380px)를 훑지 않고, 줄마다 표시가 올 수 있는 가로 띠(표시 높이 + 위아래 6px)만 훑는다.
                # 받아들이는 결과는 같고 시장 화면 인식이 약 0.3초 빨라진다. 가로는 스크롤로 픽셀 단위로 밀리므로 그대로 전체를 본다.
                # 다른 해상도·기기: 줄 높이와 offset은 그 기기 프로필(reference/som/<프로필>/profile.json의 market.rows, markers[].offset)
                # 비율에서 계산하므로 따로 고칠 것 없다. 프로필의 rows가 실제 화면과 다르면 지금도 카드를 못 찾는다(띠와 무관).
                areas=[search]
                if getattr(self,'market_strips',True) and role in ('offer_structure','sold') and s.get('offset'):
                    th=self.templates[s['file']].shape[0];areas=[]
                    for r in p['rows']:
                        y0=max(search['y'],round(r*H)+round(s['offset']['y']*H)-6);y1=min(search['y']+search['height'],y0+th+12)
                        if y1-y0>=th:areas.append(bounds(search['x'],y0,search['width'],y1-y0))
                # 예전(영역 전체 한 번)과 같은 순서 — 점수 높은 것부터 — 로 합친다. market_coverage.py가 첫 카드를 격자 기준으로 쓰므로
                # 순서가 바뀌면 끝 판정이 달라질 수 있다(저장 화면 95장 중 1장에서 확인).
                hits=sorted((h for area in areas for h in self.locate(im,s,area,threshold=.94,multiple=True,scored=True)),key=lambda h:-h[1])
                for b,_ in hits:
                    if not any(abs(b['x']-v[0]['x'])<18 and abs(b['y']-v[0]['y'])<18 for v in result):result.append((b,s))
            return result
        def field(name,x,y):
            g=p['fields']['card']; w,h=g['dimensions']['width'],g['dimensions']['height']; b=box(g[name],w,h)
            b['x']+=x-round(g['origin']['x']*w);b['y']+=y-round(g['origin']['y']*h);return b
        cells=[];partial_cards=[];sold_markers=marks('sold')
        for state,role in [('offer','offer_structure'),('sold','sold')]:
            for marker,s in (sold_markers if state=='sold' else marks(role)):
                if not s['offset']:continue
                x=marker['x']-round(s['offset']['x']*W); y=marker['y']-round(s['offset']['y']*H)
                row=min(range(2),key=lambda i:abs(y-round(p['rows'][i]*H)))
                if abs(y-round(p['rows'][row]*H))>3:continue
                y=round(p['rows'][row]*H)
                if state=='sold' and (x<view['x'] or x+cw>view['x']+view['width']):
                    # A lettering match can differ by a few raster pixels from
                    # the card edge. At the viewport boundary, bind it only to
                    # one complete card border already observed in this frame.
                    aligned=[c['card']['x'] for c in cells if c['card']['y']==y and abs(c['card']['x']-x)<=3]
                    if len(aligned)==1:x=aligned[0]
                if x<view['x'] or x+cw>view['x']+view['width']:
                    # The observed structural border binds a clipped card's
                    # geometry, but supplies no product, price or input target.
                    if state=='offer':partial_cards.append(bounds(x,y,cw,ch))
                    continue
                card=bounds(x,y,cw,ch)
                cell_state=state
                # Use the configured artwork crop, including quantity overlays.
                icon=field('iconBox',x,y)
                cells.append({'id':f'{row}:{x}','state':cell_state,'card':card,'buy':field('purchaseBox',x,y),**self.roi(im,icon)})
        # The generic wooden border also matches sold cards. A SOLD sign at
        # that same observed slot takes precedence over the generic border.
        cells=[c for c in cells if c['state']!='offer' or not any(s['state']=='sold' and
            abs(c['card']['x']-s['card']['x'])<=3 and c['card']['y']==s['card']['y'] for s in cells)]
        sale=box(p['sale'],W,H)
        close=self.locate(im,p['close'])
        # Account for fully visible slots in both rows. Partially clipped edge
        # cards are excluded from the user's all-SOLD exit rule.
        geometry=market_gap_geometry(im,view,[round(r*H) for r in p['rows']],cw,ch)
        plus=[b for b,_ in marks('plus')]
        coverage=visible_sold_coverage(view,[round(r*H) for r in p['rows']],cw,ch,cells,plus)
        scan=self.market_coverage.read(im,view,[round(r*H) for r in p['rows']],cw,ch,cells,geometry,plus,sale,[b for b,_ in marks('sale')],partial_cards)
        # Current-view strips supply translation evidence only; never currency
        # identity or input coordinates. Fractions bind the excluded column.
        strips=[cut(im,bounds(view['x'],round(r*H+ch*.15),view['width'],round(ch*.65))) for r in p['rows']]
        raster=cv2.resize(cv2.cvtColor(np.concatenate(strips,axis=0),cv2.COLOR_BGR2GRAY),(384,16),interpolation=cv2.INTER_AREA)
        first_right=None
        if geometry and cells:
            pitch=geometry['pitch']*view['width']
            origin=min(c['card']['x'] for c in cells)
            origin-=np.floor((origin-view['x'])/pitch)*pitch
            if 0<=origin-view['x']<=cw*.25:first_right=float((origin+cw-view['x'])/view['width'])
        position={'raster':{'width':384,'height':16,'pixels':raster.reshape(-1).tolist()},'firstColumnRight':first_right,'originVisible':bool(marks('sale',sale))}
        return {**self.market_motion(im),'marketPosition':position,'cells':cells,'partialCards':partial_cards,'cardCoverageComplete':coverage,'close':close[0] if close else None,
                'marketRefresh':self.market_refresh.read(im,self.get_timer_ocr),
                'marketScanCoverage':scan,'scrollGeometry':geometry,
                'marketEnd':bool(marks('plus'))}
    def popup(self,im,viewport):
        crop=cut(im,viewport); H,W=crop.shape[:2]; b,g,r=[crop[:,:,i].astype(np.int16) for i in range(3)]
        pale=((r>205)&(g>175)&(b>105)&(r>=g)&(g>=b)).astype(np.uint8)*255
        pale=cv2.morphologyEx(pale,cv2.MORPH_CLOSE,np.ones((11,11),np.uint8)); panels=[]
        for c in cv2.findContours(pale,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            x,y,w,h=cv2.boundingRect(c)
            if W*.28<w<W*.95 and H*.18<h<H*.94 and W*.2<x+w/2<W*.8:panels.append(bounds(x,y,w,h))
        if not panels:return {'scene':'unknown','popupCandidates':[]}
        panel=max(panels,key=lambda z:z['width']*z['height']); x,y,w,h=panel.values(); candidates=[]
        pc=cut(crop,panel); hsv=cv2.cvtColor(pc,cv2.COLOR_BGR2HSV)
        green=((hsv[:,:,0]>35)&(hsv[:,:,0]<90)&(hsv[:,:,1]>190)&(hsv[:,:,2]>120)).astype(np.uint8)*255
        # Opening removes thin selection rims while retaining the solid button.
        green=cv2.morphologyEx(green,cv2.MORPH_OPEN,np.ones((13,13),np.uint8))
        for c in cv2.findContours(green,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            bx,by,bw,bh=cv2.boundingRect(c)
            if bw>w*.08 and bh>h*.035 and 1.5<bw/bh<7 and by>h*.35:
                candidates.append({'kind':'claim',**self.roi(im,bounds(viewport['x']+x+bx,viewport['y']+y+by,bw,bh))})
        orange=((hsv[:,:,0]<25)&(hsv[:,:,1]>85)&(hsv[:,:,2]>130)).astype(np.uint8)*255
        for c in cv2.findContours(orange,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
            bx,by,bw,bh=cv2.boundingRect(c)
            if bx>w*.70 and by<h*.24 and .65<bw/bh<1.5 and w*.018<bw<w*.095 and h*.02<bh<h*.14:
                candidates.append({'kind':'close',**self.roi(im,bounds(viewport['x']+x+bx-2,viewport['y']+y+by-2,bw+4,bh+4))})
        # Some events put a dark X in a coloured ribbon above the pale body.
        # Search only the observed panel's upper-right header neighbourhood.
        # Edges supply geometry; D1 still decides whether a candidate is an X.
        hx=max(0,round(x+w*.70));hy=max(0,round(y-h*.28))
        hw=min(W-hx,round(w*.36));hh=min(H-hy,round(h*.50))
        header_search=bounds(hx,hy,hw,hh)
        gray=cv2.GaussianBlur(cv2.cvtColor(cut(crop,header_search),cv2.COLOR_BGR2GRAY),(3,3),0)
        edges=cv2.morphologyEx(cv2.Canny(gray,8,24),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        extras=[]
        for c in cv2.findContours(edges,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)[0]:
            bx,by,bw,bh=cv2.boundingRect(c)
            if not (.70<bw/bh<1.4 and w*.025<bw<w*.075 and h*.03<bh<h*.13):continue
            b=bounds(viewport['x']+hx+bx-3,viewport['y']+hy+by-3,bw+6,bh+6)
            if b['x']<viewport['x'] or b['y']<viewport['y'] or b['x']+b['width']>viewport['x']+W or b['y']+b['height']>viewport['y']+H:continue
            if any(abs(b['x']-v['box']['x'])<12 and abs(b['y']-v['box']['y'])<12 for v in candidates+extras):continue
            extras.append({'kind':'close',**self.roi(im,b)})
        candidates.extend(sorted(extras,key=lambda v:-v['box']['x'])[:8])
        candidates.sort(key=lambda v:(0 if v['kind']=='claim' else 1,v['box']['y'],-v['box']['x']))
        panel['x']+=viewport['x'];panel['y']+=viewport['y']
        # Static header/button crops avoid reward illustration and chest animation.
        header=bounds(panel['x'],panel['y'],panel['width'],max(1,round(panel['height']*.15)))
        missing=self.products_missing.detect(im,panel)
        if missing:
            close=missing['anchors'].get('close')
            popup={'kind':'products_missing',**self.roi(im,close['box'])} if close else None
            if popup:popup['contextHash']=digest(cut(im,missing['anchors']['title']['box']).tobytes())
            return {'scene':'unknown','panel':panel,'productsMissing':missing,'popupCandidates':[],
                    **({'popup':popup} if popup else {})}
        full=self.barn_full.detect(im,panel)
        close=full and full['anchors'].get('close')
        popup={'kind':'barn_full',**self.roi(im,close['box'])} if close else None
        if popup:popup['contextHash']=popup['hash']
        return {'scene':'unknown','panel':panel,'panelHeaderHash':digest(cut(im,header).tobytes()),'popupCandidates':candidates[:12],
                **({'barnFull':full} if full else {}),**({'popup':popup} if popup else {})}
    def analyze(self,data,viewport,motion_only=False,dealer_entry=False):
        im=cv2.imdecode(np.frombuffer(data,np.uint8),1)
        if im is None:raise ValueError('SOM_IMAGE_INVALID')
        H,W=im.shape[:2]
        if any(viewport[k]<0 for k in ('x','y')) or viewport['x']+viewport['width']>W or viewport['y']+viewport['height']>H:raise ValueError('SOM_VIEWPORT_INVALID')
        popup=self.popup(im,viewport)
        if popup.get('productsMissing'):return popup
        minigame=self.minigame.detect(im,viewport)
        if minigame:
            title=minigame['anchors']['helicopter']['region']
            title=bounds(viewport['x']+round(title['x']*viewport['width']),viewport['y']+round(title['y']*viewport['height']),
                         round(title['width']*viewport['width']),round(title['height']*viewport['height']))
            return {'scene':'helicopter','minigame':minigame,'pins':[],'missing':[],'send':None,'close':None,
                    'helicopterTitle':title,'orderHash':digest(cut(im,viewport).tobytes())}
        # A dimmed market title can still correlate with its template. The
        # explicit full-barn modal must take precedence over that background.
        if popup.get('barnFull'):return popup
        dealer=self.dealer.analyze(im,viewport)
        if dealer:return dealer
        barn=self.barn.analyze(im,viewport)
        if barn:return barn
        if self.p['dimensions']=={'width':W,'height':H} and viewport==box(self.p['viewport'],W,H):
            heli_anchors=[self.locate(im,a) for a in self.p['heli']['anchors']]
            if all(heli_anchors):return {**self.helicopter(im),'helicopterTitle':heli_anchors[0][0]}
            if all(self.locate(im,a) for a in self.p['market']['anchors']):
                result=self.market_motion(im) if motion_only else self.market(im)
                if dealer_entry:result['dealerSearch']=self.dealer.entry(im,viewport,result['view'])
                return result
            town=self.p['town']
            if self.locate(im,town['anchor']):
                heli=self.locate(im,town['helicopter'])
                return {'scene':'town','helicopter':heli[0] if heli else None,'market':self.town_market_target(viewport),'barn':self.town_target(viewport,'barn')}
        return popup

if __name__=='__main__':
    vision=Vision(sys.argv[1]);print(json.dumps({'kind':'ready','profileHash':vision.hash}),flush=True)
    for line in sys.stdin:
        try:
            req=json.loads(line); result=vision.analyze(base64.b64decode(req['image']),req['viewport'],req.get('motionOnly') is True,req.get('dealerEntry') is True)
            print(json.dumps({'id':req['id'],'ok':True,'result':result}),flush=True)
        except Exception as e: print(json.dumps({'id':locals().get('req',{}).get('id'),'ok':False,'error':str(e)}),flush=True)
