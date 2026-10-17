import {registeredMarketStatic} from './mumu-market-static.mjs';
import {resolvePercentageProfile} from './percentage-profile.mjs';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng,regionDigest,validateBox} from './adb.mjs';
import {acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {sameMarketSoldSlot} from './mumu-market-sold-slot.mjs';
import {confirmedMarketScreenshot,marketPurchaseHold,validateMarketScreenshots} from './mumu-market-products.mjs';
import {locateCapacityEntry,capacityRoles,readMarketCapacityPanel,currentMarketCapacity,validateCapacityRegistration} from './mumu-market-capacity.mjs';
import {locateNavigationCore,locateNavigationVariants,boundNavigationOriginal} from './mumu-navigation-locator.mjs';
export const MARKET_READER='program-market';
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=x=>{throw Error(x);};
const profileFile=fileURLToPath(new URL('../reference/market-recognition/profile.json',import.meta.url));
export function marketProfile(){
  const bytes=readFileSync(profileFile),profile=resolvePercentageProfile(JSON.parse(bytes)),assets=new Map();
  if(profile.schema!==1||profile.provider!=='google_play_windows')fail('MARKET_PROFILE_CHANGED');
  if(profile.navigationLocationVersion!==1||profile.layouts.filter(l=>l.executionEnabled===true).some(l=>
    [l.close,...(l.helicopterExit?[l.helicopterExit.close]:[]),...(l.townNavigation?[l.townNavigation.market,...l.townNavigation.marketAlternates??[],l.townNavigation.helicopter]:[])].some(s=>s.locator?.schema!==1)))fail('NAVIGATION_LOCATOR_REGISTRATION_REQUIRED');
  for(const a of profile.assets){if(a.file!==a.file.split(/[\\/]/).at(-1))fail('MARKET_ASSET_CHANGED');
    const bytes=readFileSync(join(dirname(profileFile),a.file));if(digest(bytes)!==a.sha256)fail('MARKET_ASSET_CHANGED');assets.set(a.file,decodePng(bytes));}
  validateMarketScreenshots(profile,assets,dirname(profileFile));
  validateCapacityRegistration(profile,assets,dirname(profileFile));
  const manifest=readFileSync(new URL('../reference/product-upper-crops/manifest.json',import.meta.url));
  const thresholds=readFileSync(new URL('../reference/product-recognition/thresholds.json',import.meta.url));
  const settings=JSON.parse(thresholds);if(settings.catalogueManifestSha256!==digest(manifest))fail('MARKET_CATALOGUE_CHANGED');
  return {profile,hash:digest(bytes),assets,catalogueManifestSha256:digest(manifest),thresholdSha256:digest(thresholds)};
}
export function marketLayout(frame,reg=marketProfile()){
  return reg.profile.layouts.find(l=>l.dimensions.width===frame.width&&l.dimensions.height===frame.height&&
    l.id===frame.review?.data?.market?.layoutId)??null;
}
const exactSpec=(image,spec,reg)=>{try{const t=reg.assets.get(spec?.file);return !!t&&t.width===spec.box.width&&
  t.height===spec.box.height&&t.channels===image.channels&&regionDigest(t)===regionDigest(image,spec.box);}catch{return false;}};
// Registered static navigation pixels tolerate only the small raster changes
// seen across native captures. This is not the immediate input preflight.
export function marketExitRegionMatches(image,spec,reg=marketProfile()){return registeredMarketStatic(image,spec,reg);}
export function locateMarketNavigation(image,spec,reg=marketProfile()){
  return locateNavigationCore(image,spec,reg.assets.get(spec.file),(im,s)=>s.mode==='static'?marketExitRegionMatches(im,s,reg):exactSpec(im,s,reg));
}
export function readMarketTown(image,reg=marketProfile()){
  const layouts=reg.profile.layouts.filter(l=>l.dimensions.width===image.width&&l.dimensions.height===image.height&&
    l.townNavigation?.sourceRegistered&&l.townNavigation.anchors.every(a=>a.mode==='static'?marketExitRegionMatches(image,a,reg):exactSpec(image,a,reg)));
  if(layouts.length!==1)return {supported:false,reason:'MARKET_TOWN_NATIVE_EVIDENCE_REQUIRED'};
  const layout=layouts[0],t=layout.townNavigation;
  const market=locateNavigationVariants(image,[t.market,...t.marketAlternates??[]],reg.assets,(im,s)=>s.mode==='static'?marketExitRegionMatches(im,s,reg):exactSpec(im,s,reg));
  const helicopter=locateMarketNavigation(image,t.helicopter,reg);
  return {supported:true,layoutId:layout.id,marketVisible:!!market,
    marketBox:market?.box??null,marketTemplate:market?.spec.file??null,
    helicopterVisible:!!helicopter,helicopterBox:helicopter,executionEnabled:reg.profile.executionEnabled&&layout.executionEnabled};
}
export function marketTargets(frame,data,reg=marketProfile()){
  const l=reg.profile.layouts.find(l=>l.id===data.market.layoutId),m=data.market;
  if(!l||reg.profile.executionEnabled!==true||l.executionEnabled!==true||l.nativeSourceResultRegistered!==true)return [];
  const navigation=['transport_exit','enter','return_order','close','exhausted','capacity_entry','capacity_close'].includes(data.marketDecision?.kind);
  const image=(navigation||l.anchors.some(a=>a.locator))&&frame.evidenceRef?boundNavigationOriginal(frame):null;
  const locate=spec=>image?locateMarketNavigation(image,spec,reg):spec?.box;
  if(capacityRoles.has(data.marketDecision?.kind)){
    const c=l.capacityObservation,entry=data.marketDecision.kind==='capacity_entry';
    const entryBox=entry?locateCapacityEntry(image,c,reg):null;
    if(!c||!image||(entry?(!readMarketTown(image,reg).supported||!entryBox):
      readMarketCapacityPanel(image,reg)?.layoutId!==l.id))return [];
    const box=entry?entryBox:c.close.box,anchors=entry?l.townNavigation.anchors:c.anchors;
    return [{id:'market-'+data.marketDecision.kind,kind:entry?'open_barn':'close_panel',type:'tap',box,
      marketNative:{schema:1,role:data.marketDecision.kind,profileHash:reg.hash,needHash:data.currentNeeds.hash,visitId:frame.sceneId,epoch:frame.epoch},
      verification:{version:1,maxChangedRatio:0,channelTolerance:0,anchorBoxes:anchors.map(a=>a.box),targetRegions:[box],
        criticalRegions:[{field:'navigation_geometry',box}]}}];
  }
  if(data.marketDecision?.kind==='transport_exit'){
    const h=l.helicopterExit;if(!h?.sourceRegistered||data.transportExit?.from!=='helicopter'||data.order!==undefined)return [];
    const close=locate(h.close);if(!close)return [];
    return [{id:'native-market-helicopter-exit',kind:'close_panel',type:'tap',box:close,
      marketTownNavigation:{schema:1,role:'transport_exit',profileHash:reg.hash},
      verification:{version:1,maxChangedRatio:0,channelTolerance:0,anchorBoxes:h.anchors.map(a=>a.box),
        targetRegions:[close],criticalRegions:[{field:'navigation_geometry',box:close}]}}];
  }
  if(['enter','return_order'].includes(data.marketDecision?.kind)){
    const town=l.townNavigation,entry=data.marketDecision.kind==='enter',current=image?readMarketTown(image,reg):data.marketTown;
    const spec=entry?[town?.market,...town?.marketAlternates??[]].find(s=>current?.marketTemplate?s?.file===current.marketTemplate:same(s?.box,current?.marketBox??town?.market?.box)):town?.helicopter;
    if(!town?.sourceRegistered||!spec||(entry?data.marketTown?.marketVisible!==true:data.marketTown?.helicopterVisible!==true))return [];
    const box=image?(entry?current.marketBox:current.helicopterBox):spec.box;
    if(!box||image&&!same(current,data.marketTown))return [];
    const target={id:entry?'native-market-entry':'native-market-order-return',kind:entry?'open_market':'open_helicopter',type:'tap',box,
      verification:{version:1,maxChangedRatio:0,channelTolerance:0,anchorBoxes:town.anchors.slice(0,3).map(a=>a.box),
        targetRegions:[box],criticalRegions:[{field:'navigation_geometry',box},
          ...town.anchors.slice(3).map(a=>({field:'navigation_anchor',box:a.box}))]}};
    if(entry)target.marketNative={schema:1,role:'entry',profileHash:reg.hash,needHash:data.currentNeeds.hash,visitId:frame.sceneId,epoch:frame.epoch};
    else target.marketTownNavigation={schema:1,role:'order_return',profileHash:reg.hash};
    return [target];
  }
  const anchorBoxes=l.anchors.map(a=>a.locator?locate(a):a.box);if(anchorBoxes.some(b=>!b))return [];
  const v={version:1,maxChangedRatio:0,channelTolerance:0,anchorBoxes};
  const targets=[];
  if(data.marketDecision?.kind==='buy'){
    const r=data.rows.find(r=>r.slotId===data.marketDecision.slotId),allocation=data.currentNeeds.allocations.find(a=>a.itemId===r?.itemId&&a.shortage>0);
    if(!r||r.identity?.status!=='matched'||!r.fullyVisible||r.currency!=='COIN'||!Number.isSafeInteger(r.quantity)||r.quantity<1||!allocation)return [];
    if(reg.profile.screenshotProductsOnly&&(!confirmedMarketScreenshot(r,l,reg)||marketPurchaseHold(r,reg.profile,data.marketCapacity)))return [];
    targets.push({id:'market-buy:'+r.slotId,kind:'buy_market',type:'tap',box:r.purchaseBox,
      marketNative:{schema:1,role:'purchase',slotId:r.slotId,profileHash:reg.hash,needHash:data.currentNeeds.hash,
        visitId:frame.sceneId,epoch:frame.epoch,itemId:r.itemId,quantity:r.quantity,logicalPosition:r.logicalPosition,
        ...reg.profile.requirePurchaseCapacity?{capacityFrameId:data.marketCapacity.frameId,capacityEvidenceHash:data.marketCapacity.evidenceHash}:{}},
      management:{purpose:'transport',verified:true,programVerified:true,currency:'COIN',itemId:r.itemId,quantity:r.quantity,
        orderId:allocation.orderId,source:'current_market_bundle',numericResourcePrecheck:false,
        ...reg.profile.screenshotProductsOnly?{price:r.price,capacityChecked:true}:{}},
      verification:{...v,targetRegions:[r.purchaseBox],criticalRegions:[{field:'item',box:r.iconBox},{field:'quantity',box:r.quantityBox},{field:'currency',box:r.currencyBox},{field:'price',box:r.purchaseBox}]}});
  }else if(data.marketDecision?.kind==='scroll'){
    const b=l.viewport,inset=30,distance=l.scrollDistance??Math.floor(b.width-l.columnPitch*1.5),y=l.scrollY??b.y+Math.floor(b.height/2);
    if(!Number.isSafeInteger(y)||y<b.y||y>=b.y+b.height)return [];
    if(!Number.isSafeInteger(distance)||distance<30||distance>=b.width-inset*2)return [];
    const durationMs=l.scrollDurationMs??900;if(!Number.isSafeInteger(durationMs)||durationMs<900||durationMs>2000)return [];
    const swipe={x1:b.x+b.width-inset,y1:y,x2:b.x+b.width-inset-distance,y2:y,durationMs};
    // Registered card rows include icons, quantities, currency, price and SOLD.
    // Exclude the shelf gaps and outer decorative margin from pixel preflight.
    const rows=l.rows.map(y=>({x:b.x,y:Math.max(b.y,y-29),width:b.width,height:Math.min(b.y+b.height,y+l.cardHeight)-Math.max(b.y,y-29)}));
    targets.push({id:'market-scroll:right',kind:'market_scroll',type:'swipe',box:b,swipe,
      marketNative:{schema:1,role:'scroll',profileHash:reg.hash,needHash:data.currentNeeds.hash,visitId:frame.sceneId,epoch:frame.epoch},
      verification:{...v,targetRegions:rows,criticalRegions:rows.map(box=>({field:'market_viewport',box}))}});
  }else if(['close','exhausted'].includes(data.marketDecision?.kind)){
    const close=locate(l.close);if(!close)return [];
    targets.push({id:'market-close',kind:'close_panel',type:'tap',box:close,
    marketNative:{schema:1,role:'close',profileHash:reg.hash,needHash:data.currentNeeds.hash,visitId:frame.sceneId,epoch:frame.epoch},
    verification:{...v,targetRegions:[close],criticalRegions:[]}});
  }
  return targets;
}
export function validateMarketProof(frame,reg=null){
  if(frame.review?.reviewedBy!==MARKET_READER)return;
  reg??=marketProfile();
  const r=frame.review,p=r.proof,m=r.data?.market;
  if(!acceptedFacts(frame)||p.schema!=='program-market-1'||p.profileHash!==reg.hash||
    p.catalogueManifestSha256!==reg.catalogueManifestSha256||p.thresholdSha256!==reg.thresholdSha256||
    p.frameId!==frame.id||p.evidenceHash!==frame.evidenceHash||p.reviewHash!==reviewFactHash(r)||
    !m||!Array.isArray(r.data.rows)||r.actualEntityId!==null||!['market','town','helicopter','barn'].includes(r.actualKind))fail('MARKET_PROOF_CHANGED');
  const l=marketLayout(frame,reg);
  if(!l)fail('MARKET_GEOMETRY_REQUIRED');
  if(p.role!=='result'&&(l.anchors.some(a=>a.locator)||['transport_exit','enter','return_order','close','exhausted'].includes(r.data.marketDecision?.kind))&&
    (l.close.locator||l.helicopterExit?.close.locator||l.townNavigation?.market.locator))boundNavigationOriginal(frame);
  if(p.role==='source'&&(!['market','town','barn'].includes(r.actualKind)||r.actualKind==='town'&&
    !['enter','return_order','capacity_entry'].includes(r.data.marketDecision?.kind)||r.actualKind==='barn'&&r.data.marketDecision?.kind!=='capacity_close'||
    !same(r.targets,marketTargets(frame,r.data,reg))))fail('MARKET_TARGET_PROOF_CHANGED');
  if(p.role==='transport_exit'&&(r.actualKind!=='helicopter'||r.data.order!==undefined||
    r.data.marketDecision?.kind!=='transport_exit'||!same(r.targets,marketTargets(frame,r.data,reg))))fail('MARKET_TRANSPORT_EXIT_PROOF_CHANGED');
  if(!['source','result','transport_exit'].includes(p.role))fail('MARKET_PROOF_CHANGED');
  if(p.role==='result'&&(r.targets.length||p.inputId!==r.data.actionResult?.actionId||r.data.actionResult?.confirmed!==true))fail('MARKET_RESULT_PROOF_CHANGED');
  if(r.actualKind==='barn'&&readMarketCapacityPanel(boundNavigationOriginal(frame),reg)?.layoutId!==l.id)fail('MARKET_CAPACITY_PANEL_REQUIRED');
}
export function validNativeMarketTarget(frame,target,reg=marketProfile()){
  if(frame.review?.reviewedBy!==MARKET_READER||target?.marketNative?.schema!==1)return false;
  validateMarketProof(frame,reg);
  const l=marketLayout(frame,reg);
  return frame.provider==='google_play_windows'&&reg.profile.executionEnabled===true&&l?.executionEnabled===true&&
    l.nativeSourceResultRegistered===true&&frame.review.proof.role==='source'&&frame.review.targets.some(t=>same(t,target));
}
export function validateMarketInput(state,frame,target,now,{pending=false}={}){
  if(!target?.marketNative)return;
  if(!validNativeMarketTarget(frame,target))fail('MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED');
  const tag=target.marketNative,needs=currentScreenNeeds(state,{now});
  if(tag.needHash!==needs.hash||frame.review.data.currentNeeds.hash!==needs.hash||tag.visitId!==frame.sceneId||tag.epoch!==frame.epoch||
    !inputEvidenceValid(frame,now,state)||needs.feasible.length&&!['close','capacity_close'].includes(tag.role))fail('MARKET_CURRENT_NEEDS_CHANGED');
  if(!pending&&(state.latestFrameId!==frame.id||state.scene.epoch!==frame.epoch))fail('CURRENT_MARKET_FRAME_REQUIRED');
  if(target.kind==='buy_market'&&!(needs.needs[target.management.itemId]?.quantity>0))fail('CONFIRMED_SHORTAGE_REQUIRED');
  if(target.kind==='buy_market'&&marketProfile().profile.requirePurchaseCapacity){
    const reg=marketProfile(),capacity=currentMarketCapacity(state,frame,needs.hash,reg,now),row=frame.review.data.rows.find(r=>r.slotId===tag.slotId);
    if(!same(capacity,frame.review.data.marketCapacity)||capacity?.frameId!==tag.capacityFrameId||capacity?.evidenceHash!==tag.capacityEvidenceHash||
      marketPurchaseHold(row,reg.profile,capacity))fail('MARKET_CAPACITY_CHANGED');
  }
}
export function verifyMarketPreflight(frame,image,target,sourceImage){
  if(!target?.marketNative&&!target?.marketTownNavigation)return;
  validateMarketProof(frame);
  if(target.marketNative&&!validNativeMarketTarget(frame,target))fail('MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED');
  const reg=marketProfile(),l=marketLayout(frame,reg);
  if(image.width!==frame.width||image.height!==frame.height||sourceImage.width!==image.width||sourceImage.height!==image.height)fail('MARKET_GEOMETRY_CHANGED');
  const role=target.marketNative?.role??target.marketTownNavigation.role;
  if(capacityRoles.has(role)){
    const c=l.capacityObservation,entry=role==='capacity_entry';
    const entryBox=entry?locateCapacityEntry(image,c,reg):null;
    if(!c||(entry?(!readMarketTown(image,reg).supported||!entryBox):
      readMarketCapacityPanel(image,reg)?.layoutId!==l.id))fail('MARKET_CAPACITY_NAVIGATION_CHANGED');
    if(entry&&!same(entryBox,target.box))fail('MARKET_NAVIGATION_TARGET_CHANGED');
    const anchors=entry?l.townNavigation.anchors:c.anchors;
    for(const a of anchors)if(regionDigest(image,a.box)!==regionDigest(sourceImage,a.box))fail('MARKET_ANCHOR_CHANGED');
    return;
  }
  if(['entry','order_return'].includes(role)){
    if(!same(readMarketTown(image,reg),readMarketTown(sourceImage,reg)))fail('MARKET_NAVIGATION_TARGET_CHANGED');
  }else if(['close','transport_exit'].includes(role)){
    const spec=role==='close'?l.close:l.helicopterExit.close;
    if(!same(locateMarketNavigation(image,spec,reg),target.box))fail('MARKET_NAVIGATION_TARGET_CHANGED');
  }
  const anchors=['entry','order_return'].includes(role)?l.townNavigation.anchors:role==='transport_exit'?l.helicopterExit.anchors:l.anchors;
  for(const a of anchors){
    const box=a.locator?locateMarketNavigation(sourceImage,a,reg):a.box;
    if(!box||a.locator&&!same(locateMarketNavigation(image,a,reg),box)||regionDigest(image,box)!==regionDigest(sourceImage,box))fail('MARKET_ANCHOR_CHANGED');
  }
}
export function marketModalAnchorsMatch(frame,image,registration,reg=marketProfile()){
  if(!image||image.width!==frame.width||image.height!==frame.height||!registration?.anchors?.length||
    registration.dimensions?.width!==frame.width||registration.dimensions?.height!==frame.height)return false;
  try{return registration.anchors.every(a=>reg.assets.has(a.file)&&reg.assets.get(a.file).width===a.box.width&&
    reg.assets.get(a.file).height===a.box.height&&reg.assets.get(a.file).channels===image.channels&&
    regionDigest(reg.assets.get(a.file))===regionDigest(image,a.box));}catch{return false;}
}
export function decodeMarketRejectionText(frame,ocr,registration){
  const f=ocr?.fields?.[0];
  if(ocr?.frameId!==frame.id||ocr.evidenceHash!==frame.evidenceHash||ocr.epoch!==frame.epoch||
    ocr.sequence!==frame.sequence||ocr.observedAt!==frame.observedAt||ocr.scene!=='market'||ocr.fields.length!==1||
    f.fieldId!=='market-rejection:'+registration.id||f.kind!=='text'||!same(f.box,registration.messageBox)||
    !f.ocrScores?.length||f.ocrScores.some(s=>!Number.isFinite(s)||s<.95||s>1))return null;
  const normalized=text=>String(text??'').trim().replace(/\s+/g,' ').toUpperCase();
  const text=normalized(f.rawText),matches=Object.entries(registration.phrases??{}).filter(([reason,phrases])=>
    ['MARKET_INSUFFICIENT_COINS','MARKET_BARN_FULL'].includes(reason)&&Array.isArray(phrases)&&
    phrases.some(p=>normalized(p)&&normalized(p)===text));
  return matches.length===1?{id:registration.id,reason:matches[0][0],mode:'registered_modal_text',messageEvidence:f}:null;
}
export const MARKET_FAILURE_PHRASES=Object.freeze({MARKET_INSUFFICIENT_COINS:['NOT ENOUGH COINS','INSUFFICIENT COINS'],
  MARKET_BARN_FULL:['YOUR BARN IS FULL','BARN IS FULL']});
export function genericMarketErrorModalEvidence(frame,modal,image){
  if(modal?.mode!=='opaque_common_dialog'||image?.width!==frame.width||image?.height!==frame.height)return null;
  try{
    const p=validateBox(modal.panelBox,image.width,image.height),b=validateBox(modal.buttonBox,image.width,image.height),
      m=validateBox(modal.messageBox,image.width,image.height);
    if(p.width<image.width*.25||p.width>image.width*.8||p.height<image.height*.15||p.height>image.height*.65||
      p.x+p.width/2<image.width*.25||p.x+p.width/2>image.width*.75||p.y+p.height/2<image.height*.25||p.y+p.height/2>image.height*.85||
      b.width<90||b.height<35||b.x<p.x||b.x+b.width>p.x+p.width||b.y<p.y+p.height*.5||b.y+b.height>p.y+p.height||
      m.x<p.x||m.y<p.y||m.x+m.width>p.x+p.width||m.y+m.height>b.y)return null;
    const ratio=(box,predicate)=>{let good=0,total=0;for(let y=box.y;y<box.y+box.height;y+=2)for(let x=box.x;x<box.x+box.width;x+=2){
      const i=(y*image.width+x)*image.channels,[r,g,b]=image.pixels.subarray(i,i+3);total++;
      if(image.channels===4&&image.pixels[i+3]!==255)return 0;if(predicate(r,g,b))good++;}return good/total;};
    if(ratio(p,(r,g,b)=>r>=210&&g>=185&&b>=130)<.55||
      ratio(b,(r,g,b)=>g>r+20&&g>b+20&&g>130||b>r+25&&b>g+10&&b>120)<.45)return null;
    return {id:'township-generic-error',messageBox:m,phrases:MARKET_FAILURE_PHRASES};
  }catch{return null;}
}
export function marketRejectionEvidence(frame,reading,image,reg=marketProfile()){
  const claim=reading.rejection;
  if(claim?.mode==='generic_error_modal'){
    const registration=genericMarketErrorModalEvidence(frame,claim.modal,image);if(!registration)return null;
    const decoded=decodeMarketRejectionText(frame,claim.ocr,registration);
    return decoded?.reason===claim.reason?{rejectionReason:claim.reason,rejectionRegistrationId:'township-generic-error',
      recognitionBasis:'opaque_modal_and_exact_error_phrase',liveErrorEvidence:false}:null;
  }
  if(claim?.mode==='registered_modal_text'){
    const registration=reg.profile.rejectionText?.find(r=>r.id===claim.id&&r.layoutId===reading.market?.layoutId);
    if(!marketModalAnchorsMatch(frame,image,registration,reg))return null;
    const decoded=decodeMarketRejectionText(frame,claim.ocr,registration);
    return decoded?.reason===claim.reason?{rejectionReason:claim.reason,rejectionRegistrationId:registration.id}:null;
  }
  const registration=reg.profile.rejections?.find(r=>r.id===claim?.id&&r.reason===claim.reason&&
    r.dimensions?.width===frame.width&&r.dimensions?.height===frame.height);
  if(!image||image.width!==frame.width||image.height!==frame.height||!registration?.anchors?.length||
    !['MARKET_INSUFFICIENT_COINS','MARKET_BARN_FULL'].includes(claim.reason))return null;
  // Explicit failures require hash-registered original pixels. A title or
  // arbitrary candidate reason alone cannot settle a purchase input.
  try{
    if(registration.anchors.some(a=>!reg.assets.has(a.file)||reg.assets.get(a.file).width!==a.box.width||
      reg.assets.get(a.file).height!==a.box.height||reg.assets.get(a.file).channels!==image.channels||
      regionDigest(reg.assets.get(a.file))!==regionDigest(image,a.box)))return null;
  }catch{return null;}
  return {rejectionReason:claim.reason,rejectionRegistrationId:registration.id};
}
export function marketPurchaseResult(state,action,frame,reading,image=null){
  if(action?.target?.kind!=='buy_market'||!action.target.marketNative||state.input!==action.id||!['issued','captured'].includes(action.status))return null;
  const before=state.frames[action.frameId],m=action.target.management;
  if(!before||!validNativeMarketTarget(before,action.target)||frame.provider!==before.provider||frame.serial!==before.serial||
    frame.width!==before.width||frame.height!==before.height||!same(frame.captureTarget,before.captureTarget)||
    frame.sceneId!==action.nextVisit.visitId||frame.epoch!==action.epoch||frame.sequence<=before.sequence||
    frame.evidenceHash===before.evidenceHash||!Number.isFinite(Date.parse(action.issuedAt))||
    Date.parse(frame.captureStartedAt)<Date.parse(action.issuedAt)+1000||
    action.preflightEvidence?.sourceFrameId!==before.id||action.deviceReceipt?.commandIssued!==true||
    reading.marketProfileHash!==before.review.proof.profileHash||reading.market?.layoutId!==before.review.data.market.layoutId)return null;
  if(reading.rejection){
    const rejected=marketRejectionEvidence(frame,reading,image);if(!rejected)return null;
    return {actionId:action.id,frameId:frame.id,confirmed:true,effect:'market_purchase_rejected',
      itemId:m.itemId,quantity:m.quantity,purchaseRejected:true,acquiredQuantity:0,
      ...rejected,currentOwnedRecheckRequired:true};
  }
  const row=before.review.data.rows.find(r=>r.slotId===action.target.marketNative.slotId);
  const sold=reading.rows.filter(r=>sameMarketSoldSlot(before,reading,row,r));
  if(sold.length!==1)return null;
  // Conflicting observations of the original or rounded card cannot prove SOLD.
  const b=row.cardBox,c=sold[0].cardBox,rounded=!same(b,c);
  if(reading.rows.some(r=>r!==sold[0]&&r.row===row.row&&r.cardBox&&
    (same(r.cardBox,b)||same(r.cardBox,c)||rounded&&Math.abs(r.cardBox.x-b.x)<=1&&
      r.cardBox.y===b.y&&r.cardBox.width===b.width&&r.cardBox.height===b.height)))return null;
  return {actionId:action.id,frameId:frame.id,confirmed:true,effect:'market_bundle_sold',itemId:m.itemId,quantity:m.quantity,
    soldConfirmed:true,temporaryAcquisitionOnly:true,currentOwnedRecheckRequired:true};
}
export const marketProofHash=sha;
