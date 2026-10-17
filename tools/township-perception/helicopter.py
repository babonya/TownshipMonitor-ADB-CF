from percentage_profile import resolve_percentage_profile
"""Scoped helicopter candidates from reviewed templates. No game inputs."""
import json
import re
from pathlib import Path
import cv2
import numpy as np
from matching import ContractError, box, decode, digest, intersects
from image_assets import verified_asset
from product_scores import select_product
from frame_context import frame_pixels

class HelicopterAnalyzer:
    def __init__(self, profile_file, catalogue=None):
        path=Path(profile_file)
        raw=path.read_bytes()
        self.profile= resolve_percentage_profile(json.loads(raw.decode('utf-8-sig')))
        if self.profile.get('schema')!=1 or self.profile.get('dimensions') not in ({'width':1600,'height':900},{'width':1114,'height':735},{'width':1578,'height':1268}):
            raise ContractError('HELICOPTER_PROFILE_INVALID')
        self.profile_hash=digest(raw)
        inset=self.profile.get('quantityContentInset',0)
        if type(inset) is not int or inset<0 or any(2*inset>=s['quantityBox']['height'] for s in self.profile['slots']):
            raise ContractError('HELICOPTER_QUANTITY_CONTENT_REGION_INVALID')
        self.screenshot_products_only=bool(self.profile.get('screenshotProductsOnly',False))
        self.catalogue=None if self.screenshot_products_only else catalogue
        self.product_templates=[spec for spec in self.profile['items'] if spec.get('identitySource')!='wiki_catalog']
        self.assets={}
        self.masks={}
        for spec in self.profile['anchors']+self.product_templates+self.profile.get('buttons',[]):
            self.load_asset(path.parent,spec)
        if self.profile.get('deliveryCompletion'):
            self.load_asset(path.parent,self.profile['deliveryCompletion'])
        for spec in self.profile.get('miniGameNavigation',{}).get('anchors',[])+self.profile.get('normalOrderNavigation',{}).get('anchors',[]):
            self.load_asset(path.parent,spec)

    def load_asset(self,root,spec):
        path=(root/spec['file']).resolve()
        if path.parent!=root.resolve():raise ContractError('HELICOPTER_ASSET_PATH_INVALID')
        self.assets[spec['file']]=verified_asset(path,spec['sha256'],'HELICOPTER_ASSET_CHANGED').image
        if spec.get('identityMaskFile'):
            mask_path=(root/spec['identityMaskFile']).resolve()
            if mask_path.parent!=root.resolve():raise ContractError('HELICOPTER_MASK_PATH_INVALID')
            mask_image=verified_asset(mask_path,spec.get('identityMaskHash'),'HELICOPTER_MASK_CHANGED').image
            mask=cv2.cvtColor(mask_image,cv2.COLOR_BGR2GRAY)
            image=self.assets[spec['file']]
            if mask.shape!=image.shape[:2] or not np.all((mask==0)|(mask==255)):
                raise ContractError('HELICOPTER_MASK_INVALID')
            pixels=image[mask>0]
            if len(pixels)<256 or len(pixels)<mask.size*.25 or pixels.std(axis=0).max()<10:
                raise ContractError('HELICOPTER_MASK_LOW_INFORMATION')
            self.masks[(spec['file'],spec['identityMaskFile'])]=mask

    def health(self):return {'helicopterProfileHash':self.profile_hash,'helicopterProfileVersion':self.profile['version'],
        'helicopterCatalogueEnabled':self.catalogue is not None,**(self.catalogue.health() if self.catalogue else {})}

    def match(self,image,spec,region):
        x,y,w,h=box(region,image.shape[1],image.shape[0])
        template=self.assets[spec['file']]
        th,tw=template.shape[:2]
        if tw>w or th>h:return -1,None
        scores=cv2.matchTemplate(image[y:y+h,x:x+w],template,cv2.TM_CCOEFF_NORMED,mask=self.masks.get((spec['file'],spec.get('identityMaskFile'))))
        scores=np.where(np.isfinite(scores)&(scores>=-1.001)&(scores<=1.001),np.clip(scores,-1,1),-1).astype(np.float32)
        _,score,_,(dx,dy)=cv2.minMaxLoc(scores)
        return float(score),dict(x=x+dx,y=y+dy,width=tw,height=th)

    def match_item(self,image,spec,slot):
        region=slot['iconBox']
        if spec.get('matchMode')=='masked_full_product':
            if not spec.get('identityMaskFile'):raise ContractError('HELICOPTER_MASK_REQUIRED')
            shared=next((s for s in self.profile.get('sharedProductRecognition',{}).get('slots',[]) if s['slotId']==slot['slotId']),None)
            if not shared:return -1,None
            b=shared['box'];bottom=min(b['y']+b['height'],slot['quantityBox']['y'])
            # Small source-to-slot raster rounding tolerance, never resizing.
            # Approved masks exclude overlays with clearance for this search.
            x=max(0,b['x']-2);y=max(0,b['y']-2)
            region={'x':x,'y':y,'width':min(image.shape[1],b['x']+b['width']+2)-x,
                    'height':min(image.shape[0],bottom+2)-y}
        return self.match(image,spec,region)

    @staticmethod
    def signal(image,region):
        x,y,w,h=box(region,image.shape[1],image.shape[0])
        pixels=image[y:y+h,x:x+w].astype(np.int16)
        median=np.median(pixels.reshape(-1,3),axis=0)
        return float(np.mean(np.max(np.abs(pixels-median),axis=2)>30))

    @staticmethod
    def check(image,region):
        x,y,w,h=box(region,image.shape[1],image.shape[0])
        hsv=cv2.cvtColor(image[y:y+h,x:x+w],cv2.COLOR_BGR2HSV)
        mask=(hsv[:,:,0]>=35)&(hsv[:,:,0]<=85)&(hsv[:,:,1]>160)&(hsv[:,:,2]>160)
        return float(np.mean(mask))>.12

    def empty(self,image,region):
        x,y,w,h=box(region,image.shape[1],image.shape[0])
        pixels=image[y:y+h,x:x+w].astype(np.int16)
        # A flat popup/black mask is not an empty order slot. Match the known
        # cream background as well as low texture before omitting any demand.
        color=np.array(self.profile['emptyBackgroundBgr'])
        return self.signal(image,region)<.005 and float(np.mean(np.max(np.abs(pixels-color),axis=2)>14))<.005

    def analyze(self,data,base,customer_icons_only=False,*,context=None):
        image=frame_pixels(data,base,context)
        result={**base,**self.health(),'slots':[],'customers':[],'selectedCustomerId':None,'sendBox':self.profile['sendBox']}
        if {'width':image.shape[1],'height':image.shape[0]}!=self.profile['dimensions']:
            return {**result,'status':'unsupported','reason':'HELICOPTER_GEOMETRY_UNSUPPORTED','coordinateState':'unusable'}
        for spec in self.profile['anchors']:
            score,_=self.match(image,spec,spec['sourceBox'])
            if score<spec['minimumScore']:
                return {**result,'status':'unsupported','reason':'HELICOPTER_ANCHOR_REQUIRED','coordinateState':'unusable'}
        result.update(status='candidate',scene={'kind':'helicopter'},coordinateState='requires_preflight')
        mini=self.profile.get('miniGameNavigation')
        if mini and mini.get('kind')=='mini_game_navigation_only' and len(mini.get('anchors',[]))==2:
            anchors=[]
            for spec in mini['anchors']:
                score,matched=self.match(image,spec,spec['sourceBox'])
                anchors.append({'file':spec['file'],'matchScore':score,'box':matched})
            if all(a['matchScore']>=s['minimumScore'] for a,s in zip(anchors,mini['anchors'])):
                result['miniGameNavigation']={'status':'matched_candidate','anchors':anchors}
                result['slots']=[{**slot,'status':'empty','itemId':None,'checkPresent':False} for slot in self.profile['slots']]
                result['mapTargets']=[p for p in self.map_targets(image) if p['pinState']=='red']
                result['deleteAvailable']=False
                return result
        normal=self.profile.get('normalOrderNavigation')
        if normal and mini:
            label=mini['anchors'][0]
            label_score,label_box=self.match(image,label,label['sourceBox'])
            anchors=[]
            for spec in normal['anchors']:
                score,matched=self.match(image,spec,spec['sourceBox'])
                anchors.append({'file':spec['file'],'matchScore':score,'box':matched})
            if label_score<label['minimumScore'] and all(a['matchScore']>=s['minimumScore'] for a,s in zip(anchors,normal['anchors'])):
                result['normalOrderNavigation']={'status':'matched_candidate','anchors':anchors,'miniGameAbsent':True,
                    'miniGameLabel':{'file':label['file'],'matchScore':label_score,'box':label_box}}
                critical=[]
                def measured_region(x,y,w,h,check):
                    patch=image[y:y+h,x:x+w].copy()
                    left=max(x,check['x']);top=max(y,check['y'])
                    right=min(x+w,check['x']+check['width']);bottom=min(y+h,check['y']+check['height'])
                    if right>left and bottom>top:patch[top-y:bottom-y,left-x:right-x]=0
                    return patch.tobytes()
                for slot in self.profile['slots']:
                    g=next(s for s in self.profile['sharedProductRecognition']['slots'] if s['slotId']==slot['slotId'])
                    b=g['box'];x,y,w=b['x'],b['y'],b['width'];critical.append(measured_region(x,y,w,g['overlayTop']-y,slot['checkBox']))
                    q=slot['quantityBox'];x,y=q['x'],q['y']+8;critical.append(measured_region(x,y,84,36,slot['checkBox']))
                result['selectionGridHash']=digest(b''.join(critical))
        # The checked parcel replaces the grid after SEND. Match only this
        # static panel, excluding reward animation and all customer imagery.
        completion=self.profile.get('deliveryCompletion')
        if completion:
            score,matched=self.match(image,completion,completion['sourceBox'])
            if score>=completion['minimumScore']:
                result['deliveryCompletion']={'status':'matched_candidate','matchScore':score,'box':matched}
                result['slots']=[{**slot,'status':'empty','itemId':None,'checkPresent':False} for slot in self.profile['slots']]
                result['mapTargets']=self.map_targets(image)
                result['deleteAvailable']=False
                return result
        for slot in self.profile['slots']:
            inset=self.profile.get('quantityContentInset',0)
            quantity_content={**slot['quantityBox'],'y':slot['quantityBox']['y']+inset,'height':slot['quantityBox']['height']-2*inset}
            # OCR padding can cross the static reward divider in a blank row.
            # Slot presence uses the complete original text band, independently
            # of the padded numeric OCR region and product identity.
            if self.empty(image,slot['iconBox']) and self.empty(image,quantity_content):
                result['slots'].append({**slot,'status':'empty','itemId':None,'checkPresent':False})
                continue
            selection=select_product(({'itemId':spec['itemId'],'score':self.match_item(image,spec,slot)[0],
                'minimumScore':spec['minimumScore'],'minimumMargin':spec['minimumMargin'],'spec':spec}
                for spec in self.product_templates),require_competitor=True)
            score=selection.best['score'] if selection.best else None
            spec=selection.best['spec'] if selection.best else None
            margin=selection.margin;known=selection.matched
            shared=None
            if self.catalogue and not self.profile.get('screenshotProductsOnly',False):
                geometry=next((s for s in self.profile.get('sharedProductRecognition',{}).get('slots',[]) if s['slotId']==slot['slotId']),None)
                region=dict(geometry['box'] if geometry else slot['iconBox'])
                boundary=geometry['overlayTop'] if geometry else min(slot['checkBox']['y']-2,slot['quantityBox']['y']-2)
                shared=self.catalogue.match(image,region,'delivery',overlay_top=boundary,native_item=spec['itemId'] if known else None)
                # Shared crop takes precedence only after context calibration.
                # Existing native templates explicitly remain the fallback.
                if shared['status']=='matched':
                    if known and spec['itemId']!=shared['itemId']:
                        shared={**shared,'status':'uncertain','itemId':None,'reason':'NATIVE_SHARED_IDENTITY_CONFLICT'};known=False
                    else:
                        spec={'itemId':shared['itemId']};score=shared['matchScore'];margin=shared['scoreMargin'];known=True
            result['slots'].append({**slot,'status':'matched_candidate' if known else 'unknown','itemId':spec['itemId'] if known else None,
                'productPresent':self.signal(image,slot['iconBox'])>=.025,
                'matchScore':round(score,6) if score is not None else None,'scoreMargin':round(margin,6) if margin is not None else None,'checkPresent':self.check(image,slot['checkBox']),
                **({'identitySource':'wiki_upper_crop' if shared['status']=='matched' else 'native_validated_fallback' if known else 'unknown',
                    'sharedIdentity':shared} if shared else {})})
        result['mapTargets']=self.map_targets(image)
        result['deleteAvailable']=any(s.get('kind')=='delete_helicopter' and self.match(image,s,s['sourceBox'])[0]>=s['minimumScore'] for s in self.profile.get('buttons',[]))
        return result

    def map_targets(self,image):
        # Navigation geometry only. No portraits, faces, names or identity templates.
        scale=self.profile.get('pinScale',1);tip=max(1,round(9*scale));offset=max(1,round(8*scale));half=max(2,round(5*scale))
        x0,y0,w0,h0=box(self.profile['mapBox'],image.shape[1],image.shape[0])
        hsv=cv2.cvtColor(image[y0:y0+h0,x0:x0+w0],cv2.COLOR_BGR2HSV)
        vivid=(hsv[:,:,1]>170)&(hsv[:,:,2]>215)
        result=[]
        for state,hue in [('green',(hsv[:,:,0]>=35)&(hsv[:,:,0]<=85)),('red',(hsv[:,:,0]<15)|(hsv[:,:,0]>170))]:
            minimum_height=self.profile.get('pinMinimumHeights',{}).get(state,60)
            mask=(vivid&hue).astype(np.uint8)*255
            crop=mask
            for contour in cv2.findContours(crop,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
                contour=contour+np.array([[[x0,y0]]])
                x,y,w,h=cv2.boundingRect(contour);area=cv2.contourArea(contour)
                if not (65*scale<=w<=140*scale and minimum_height*scale<=h<=170*scale and 850*scale*scale<=area<=5000*scale*scale) or y+h>=y0+h0-1:continue
                # A thin foreground pointer can attach to the red outline and
                # extend its tail. Clean only this already-qualified contour;
                # never alter the colour mask or admit another component.
                if state=='red':
                    local=np.zeros((h,w),np.uint8)
                    cv2.drawContours(local,[contour-np.array([[[x,y]]])],-1,255,cv2.FILLED)
                    cleaned=cv2.morphologyEx(local,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
                    parts=cv2.findContours(cleaned,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]
                    core=max(parts,key=cv2.contourArea) if parts else None
                    if core is not None:
                        xx,yy,ww,hh=cv2.boundingRect(core)
                        trimmed=h-(yy+hh)
                        if cv2.contourArea(core)>=area*.9 and 4*scale<=trimmed<=24*scale:
                            old_bottom=contour[:,0,:][contour[:,0,1]>=y+h-tip]
                            core_bottom=core[:,0,:][core[:,0,1]>=yy+hh-tip]
                            # Preserve normal tips exactly. Correct only a thin
                            # spur that moves the observed core beyond the
                            # existing 24px visit-local comparison boundary.
                            if len(old_bottom) and len(core_bottom) and np.hypot(
                                np.median(old_bottom[:,0])-x-np.median(core_bottom[:,0]),trimmed)>24:
                                contour=core+np.array([[[x,y]]])
                                x,y,w,h=cv2.boundingRect(contour)
                # The narrowing coloured arrow tip is the tap core; animated body excluded.
                points=contour[:,0,:];bottom=points[points[:,1]>=y+h-tip]
                if not len(bottom) or np.ptp(bottom[:,0])>w*.45:continue
                cx=int(np.median(bottom[:,0]));cy=y+h-offset
                if not x+w*.2<cx<x+w*.8:continue
                bounds={'x':cx-half,'y':cy-half,'width':half*2,'height':half*2}
                result.append({'mapId':f'pin:{cx}:{cy}','box':bounds,'pinState':state,'status':'candidate'})
        return sorted(result,key=lambda t:(t['box']['y'],t['box']['x']))
