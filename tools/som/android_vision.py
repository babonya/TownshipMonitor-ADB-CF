"""Phone-only registrations, bound to original ADB screenshots and full raster."""
import sys,json,base64,re
from pathlib import Path
import cv2,numpy as np
from vision import Vision,box,cut,bounds,digest
from dealer import Dealer
from percentage_profile import resolve_percentage_profile
from barn import SomBarn
from barn_full import BarnFullDetector
from products_missing import ProductsMissingDetector
from market_coverage import MarketCoverage,visible_sold_coverage
from order_buttons import OrderButtons
from minigame import MinigameDetector
from partial_pins import PartialPins
from town_cards import TownCardsDetector
from popup_rules import PopupRuleDetector
# [사용자 변경 2026-10-17] 마을 카메라 기준 후보(창고·시장·헬기장·비행장) 공용 모듈.
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'addons/town-camera'))
import camera_ref

class PhoneOrderButtons(OrderButtons):
    def __init__(self,vision):
        super().__init__(Path(__file__).parent/'order-refresh/profile.json')
        # Only raster size changes. Thresholds, nearby scales and positive
        # WAIT/SPEED UP evidence use the shared SOM recognition path.
        scale=vision.p['orderButtonScale']
        for role in ('waiting','speed_up'):
            self.templates[role]=cv2.resize(self.templates[role],None,fx=scale,fy=scale)
        self.templates['send']=vision.templates[vision.p['sendLabel']['file']]

class PhoneRefresh:
    def __init__(self,vision):self.vision=vision;self.cache={};self.reset_entry()
    def reset_entry(self):self.entry_done=False;self.entry_reads=0
    def read(self,im,get_ocr):
        if self.entry_done or self.entry_reads>=2:return None
        v=self.vision;p=v.p['marketRefresh'];H,W=im.shape[:2]
        if not v.locate(im,p['caption'],box(p['captionBox'],W,H)):return None
        b=box(p['timerBox'],W,H);key=digest(cut(im,b).tobytes())
        self.entry_reads+=1
        if key not in self.cache or self.entry_reads==2:
            r=get_ocr().recognize_region(im,dict(fieldId='market-free-refresh',kind='text',box=b,scale=3,minimumScore=.82))
            if len(self.cache)>=64:self.cache.pop(next(iter(self.cache)))
            self.cache[key]={k:r[k] for k in ('rawText','ocrScores')}
        reading=self.cache[key];scores=reading.get('ocrScores',[])
        match=re.fullmatch(r'\s*(?:(\d{1,2})\s*H)?\s*(?:(\d{1,2})\s*M)?\s*(?:(\d{1,2})\s*S)?\s*',reading.get('rawText',''),re.I)
        self.entry_done=bool(match and any(match.groups()) and len(scores)==1 and scores[0]>=.82 and
                             int(match[1] or 0)<=24 and int(match[2] or 0)<60 and int(match[3] or 0)<60)
        return dict(captionVerified=True,cropHash=key,region=p['timerBox'],**reading)

class AndroidVision(Vision):
    def town_camera_ok(self,im):
        # addons/town-camera/camera_ref.py 와 같은 기준: 점수 0.8 이상, 배율 1±0.02, 중심 오차 화면 폭 1% 이내.
        # [2026-10-17] 후보 여러 장(창고·시장·헬기장·비행장) 중 하나라도 맞으면 정상(원작자 지시로 네 건물 배치 고정).
        # 점수가 0.85 미만이면 화면을 setup-local/camera-low/에 저장한다(10분에 한 장, 새 후보 등록 자료).
        refs=self.town_camera.get(im.shape[:2])
        if refs is None:refs=self.town_camera[im.shape[:2]]=camera_ref.load_refs(im.shape[1],im.shape[0])
        if not refs:return True
        ok,top=camera_ref.check(im,refs)
        if top<camera_ref.LOW_SCORE:camera_ref.save_low(im,top)
        # [2026-10-16] 허용 오차 안의 작은 어긋남도 고정 탭을 빗나가게 했다(정지사례 #9) → 찾은 건물 위치·배율을 함께 돌려줘 탭을 보정한다.
        return ok[:5] if ok else None
    def shift_town_target(self,target,camera):
        # 기준 카메라에서의 탭 점을, 현재 화면에서 찾은 창고 위치·배율에 맞춰 옮긴다.
        s,cx,cy,rx,ry=camera;x,y=target['x']+1,target['y']+1
        nx,ny=round(cx+(x-rx)*s),round(cy+(y-ry)*s)
        return bounds(nx-1,ny-1,2,2)
    def __init__(self,path):
        self.root=Path(path).parent;raw=Path(path).read_bytes();self.p=resolve_percentage_profile(json.loads(raw));self.templates={}
        if self.p.get('provider')!='android_adb':raise ValueError('ANDROID_PROFILE_REQUIRED')
        for a in self.p['assets']:
            data=(self.root/a['file']).read_bytes();s=a['source'];original=(self.root/s['file']).read_bytes()
            if digest(data)!=a['sha256'] or digest(original)!=s['sha256']:raise ValueError('ANDROID_ASSET_CHANGED')
            t=cv2.imdecode(np.frombuffer(data,np.uint8),1);o=cv2.imdecode(np.frombuffer(original,np.uint8),1)
            if o.shape[:2]!=(s['dimensions']['height'],s['dimensions']['width']) or not np.array_equal(t,cut(o,s['cropBox'])):raise ValueError('ANDROID_CROP_CHANGED')
            self.templates[a['file']]=t
        self.barn=SomBarn(self.root);self.timer_ocr=None
        # These static phrases came from an actual supplied game screenshot.
        # Their detector binds to the currently measured modal, not PC pixels.
        self.barn_full=BarnFullDetector(self.root.parent/'barn-full/profile.json')
        self.products_missing=ProductsMissingDetector(self.root.parent/'products-missing/profile.json')
        self.order_buttons=PhoneOrderButtons(self)
        self.minigame=MinigameDetector(self.root/'minigame/profile.json')
        self.dealer=Dealer(self.root.parent/'dealer/profile.json')
        # [사용자 변경 2026-10-14] Town Cards 보상 팝업(YOUR CARDS) 인식기 - TAP TO OPEN/CLAIM 글씨 띠를 탭 대상으로 삼는다.
        # [2026-10-17] 팝업 규칙은 1600 프로필에만 등록돼 있다 → 다른 프로필(1544 등)에 없으면 1600 것을 쓴다(감지기가 배율·비율을 스스로 검사).
        rule=lambda n:(self.root/n/'profile.json') if (self.root/n/'profile.json').exists() else (self.root.parent/'android-1600'/n/'profile.json')
        self.town_cards=TownCardsDetector(rule('town-cards'))
        # [사용자 변경 2026-10-15] 마을 카메라 확인용 건물 기준 이미지(addons/town-camera/camera_ref.py, 실제 캡처에서 등록).
        # [2026-10-17] 화면 크기별로 후보를 읽는다(자기 마을 등록 setup-local/town-camera 우선). 후보가 없으면 확인을 끈다.
        self.town_camera={}
        d=self.p['dimensions'];self.camera_enabled=bool(camera_ref.load_refs(d['width'],d['height']))
        # [2026-10-17] 자기 마을 등록 도구(register_town.py)가 만든 시장·창고 탭이 있으면 프로필 탭 대신 쓴다.
        user_town=camera_ref.USER_DIR/f"town-{d['width']}x{d['height']}.json";user_bytes=b''
        if user_town.exists():
            user_bytes=user_town.read_bytes();taps=json.loads(user_bytes)
            for k in ('marketTap','barnTap'):self.p['town'][k]=dict(unit='fraction',space='game',x=taps[k]['x'],y=taps[k]['y'])
        # [사용자 변경 2026-10-14] 안내 화살표·이벤트 창 X·CONTINUE 버튼 규칙(우선순위: town_cards 다음).
        self.popup_rules=[PopupRuleDetector(rule(n)) for n in ('arrow-guide','blossom-deals','event-close','continue-button','level-up','quit-finished','piggy-bank','treasure-hunt','card-received')]
        self.hash=digest(raw+self.dealer.profile_bytes+self.products_missing.profile_bytes+self.barn.profile_bytes+self.barn_full.profile_bytes+self.order_buttons.profile_bytes+self.minigame.profile_bytes+self.town_cards.profile_bytes+b''.join(d.profile_bytes for d in self.popup_rules)+user_bytes)
        self.market_refresh=PhoneRefresh(self);self.market_coverage=MarketCoverage()
        self.partial_pins=PartialPins(self.p, self.templates)

    def helicopter(self,im):
        result=super().helicopter(im)
        result["pins"]=self.partial_pins.extend(im,result["pins"])
        return result

    def market_ends(self,im,view,plus,cells=()):
        """Bind the phone's lower empty terminal slot to its visible upper +."""
        p=self.p['market'];spec=p.get('terminalEmpty');H,W=im.shape[:2]
        ends=list(plus)
        # An odd number of boxes ends with a lower + and an upper SOLD card.
        # Keep that last card in coverage; this is never an input target.
        rows=[round(r*H) for r in p['rows']];ch=round(p['cardSize']['height']*H)
        for marker in plus:
            cx=marker['x']+marker['width']/2;cy=marker['y']+marker['height']/2
            if not rows[1]<=cy<=rows[1]+ch:continue
            upper=[c['card'] for c in cells if c['state']=='sold' and abs(c['card']['y']-rows[0])<=3
                   and abs(c['card']['x']+c['card']['width']/2-cx)<=3]
            if len(upper)==1:ends.append(dict(**upper[0],role='observed_last_card'))
        if not spec:return ends
        for top in plus:
            if not round(p['rows'][0]*H)<=top['y']+top['height']/2<=round(p['rows'][0]*H+p['cardSize']['height']*H):continue
            t=self.templates[spec['file']];offset=spec['centerOffset']
            b=bounds(round(top['x']+top['width']/2+offset['x']*W-t.shape[1]/2),round(top['y']+top['height']/2+offset['y']*H-t.shape[0]/2),t.shape[1],t.shape[0])
            if b['x']<view['x'] or b['y']<view['y'] or b['x']+b['width']>view['x']+view['width'] or b['y']+b['height']>view['y']+view['height']:continue
            if not self.locate(im,spec,b):continue
            # This marker is coverage evidence only. No target or purchasable
            # cell is created for either the paid plus or the empty wood.
            ends.append(dict(**b,role='observed_empty_terminal'))
        return ends

    def market(self,im):
        result=super().market(im);H,W=im.shape[:2];p=self.p['market'];view=result['view']
        plus=[];sale=[]
        for spec in p['markers']:
            if spec['role']=='plus':plus.extend(self.locate(im,spec,view,multiple=True))
            if spec['role']=='sale':sale.extend(self.locate(im,spec,box(p['sale'],W,H),threshold=.94,multiple=True))
        ends=self.market_ends(im,view,plus,result['cells'])
        scan=self.market_coverage.read(im,view,[round(r*H) for r in p['rows']],round(p['cardSize']['width']*W),round(p['cardSize']['height']*H),
            result['cells'],result['scrollGeometry'],ends,box(p['sale'],W,H),sale,result['partialCards'])
        result['marketScanCoverage']=scan
        result['cardCoverageComplete']=visible_sold_coverage(view,[round(r*H) for r in p['rows']],round(p['cardSize']['width']*W),round(p['cardSize']['height']*H),result['cells'],ends)
        result['terminalEvidence']=ends if plus else []
        result['marketEnd']=bool(plus and scan['terminalVerified'])
        return result

    def analyze(self,data,viewport,motion_only=False,dealer_entry=False,retry_amounts=False):
        if retry_amounts:self.quantity_cache={}
        result=self._analyze(data,viewport,motion_only,dealer_entry)
        if result.get('scene') in ('town','helicopter','barn'):self.market_refresh.reset_entry()
        return result

    def _analyze(self,data,viewport,motion_only=False,dealer_entry=False):
        im=cv2.imdecode(np.frombuffer(data,np.uint8),1)
        if im is None:raise ValueError('SOM_IMAGE_INVALID')
        H,W=im.shape[:2]
        if self.p['dimensions']!=dict(width=W,height=H) or viewport!=box(self.p['viewport'],W,H):return dict(scene='unknown',reason='ANDROID_PROFILE_REQUIRED')
        popup=self.popup(im,viewport)
        if popup.get('productsMissing'):return popup
        # [사용자 변경 2026-10-14] Town Cards 화면에서 봇이 멈추지 않도록 글씨 띠를 popup(town_cards)으로 알린다.
        cards=self.town_cards.detect(im,viewport,self.roi)
        if cards:return cards
        for rule in self.popup_rules:
            found=rule.detect(im,viewport,self.roi)
            if found:return found
        minigame=self.minigame.detect(im,viewport)
        if minigame:
            title=minigame['anchors']['helicopter']['region']
            title=bounds(viewport['x']+round(title['x']*viewport['width']),viewport['y']+round(title['y']*viewport['height']),
                         round(title['width']*viewport['width']),round(title['height']*viewport['height']))
            # [사용자 변경 2026-10-14] 미니게임 주문은 건너뛰므로 다른 주문 핀과 닫기 버튼도 읽어 둔다(delivery.mjs skipMinigame).
            heli=self.helicopter(im) if all(self.locate(im,a) for a in self.p['heli']['anchors']) else {}
            return dict(scene='helicopter',minigame=minigame,helicopterTitle=title,pins=heli.get('pins',[]),missing=[],send=None,close=heli.get('close'),orderHash=digest(im.tobytes()))
        if popup.get('barnFull'):return popup
        dealer=self.dealer.analyze(im,viewport)
        if dealer:return dealer
        barn=self.barn.analyze(im,viewport)
        if barn:return barn
        heli_anchors=[self.locate(im,a) for a in self.p['heli']['anchors']]
        if all(heli_anchors):return {**self.helicopter(im),'helicopterTitle':heli_anchors[0][0]}
        if all(self.locate(im,a) for a in self.p['market']['anchors']):
            result=self.market_motion(im) if motion_only else self.market(im)
            if dealer_entry:result['dealerSearch']=self.dealer.entry(im,viewport,result['view'])
            return result
        town=self.p['town']
        # [2026-10-17 DC 피드백] 폰마다 화면 가장자리 여백(카메라 구멍 등)이 달라 왼쪽·오른쪽 HUD 버튼이 수십 px 밀린다.
        # 원래 찾는 범위는 버튼 크기와 거의 같아 40px만 밀려도 마을을 몰라 SOM_SCREEN_UNIDENTIFIED → 화면 아래 왼쪽/오른쪽 구역에서 찾는다
        # (점수 기준 0.96 그대로, 마을이 아닌 저장 화면에서 새로 잡히는 것 0건 확인).
        # [2026-10-17 사용자 지적] 안전모(town-hardhat)는 근처에 공사 중일 때만 뜬다 → 공사가 없는 마을은 마을로 인식 못 함.
        # 늘 있는 오른쪽 아래 헬기 버튼(이 봇은 헬기 주문용이라 필수)이 정확히 하나 보여도 마을로 본다(저장 화면 28장에서 오인식 0).
        H,W=im.shape[:2]
        hits=self.locate(im,town['helicopter'],search=box(dict(x=0.55,y=0.75,width=0.45,height=0.25),W,H),multiple=True)
        if len(hits)==1 or self.locate(im,town['anchor'],search=box(dict(x=0.0,y=0.7,width=0.25,height=0.3),W,H)):
            out=dict(scene='town')
            out['helicopter']=hits[0] if len(hits)==1 else None
            # Preserve the user's fixed-layout entry policy on the phone too.
            # Town recognition and the registered current viewport are required;
            # market/barn artwork matching is not an entry prerequisite.
            for name in ('market','barn'):out[name]=self.town_target(viewport,name)
            # [사용자 변경 2026-10-15] 고정 좌표는 기준 카메라에서만 맞다. 창고가 기준 배율·위치에 없으면 시장·창고 좌표를 내주지 않고
            # cameraMismatch로 알린다(delivery.mjs가 addons/town-camera로 복원 후 다시 관측).
            if self.camera_enabled:
                camera=self.town_camera_ok(im)
                if not camera:out.update(market=None,barn=None,cameraMismatch=True)
                elif camera is not True:
                    for name in ('market','barn'):out[name]=self.shift_town_target(out[name],camera)
            return out
        # Unknown panels share SOM's current-crop CLAIM/X classification.
        # Geometric candidates alone never authorize an input.
        return dict(reason='ANDROID_SCENE_UNREGISTERED',**popup)

if __name__=='__main__':
    v=AndroidVision(sys.argv[1]);print(json.dumps(dict(kind='ready',profileHash=v.hash)),flush=True)
    for line in sys.stdin:
        try:
            req=json.loads(line);result=v.analyze(base64.b64decode(req['image']),req['viewport'],req.get('motionOnly') is True,req.get('dealerEntry') is True,req.get('retryAmounts') is True)
            print(json.dumps(dict(id=req['id'],ok=True,result=result)),flush=True)
        except Exception as e:print(json.dumps(dict(id=locals().get('req',{}).get('id'),ok=False,error=str(e))),flush=True)
