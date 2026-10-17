import {resolvePercentageProfile} from './percentage-profile.mjs';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {digest} from './adb.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {helicopterProfilePath} from './mumu-perception-bridge.mjs';
import {gameTransform,nativeBox} from './windows-coordinate-space.mjs';
import {validateProductDependencies} from './mumu-product-recognition.mjs';
import {orderSignature} from './mumu-order-policy.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Native clicks may activate the unchanged window; focus is observational.
export function sameSelectionCaptureTarget(a,b){
  const stable=t=>{if(!t)return t;const {isForeground,...identityAndGeometry}=t;return identityAndGeometry;};
  return same(stable(a),stable(b));
}
export function miniGameNavigationConfirmed(matching,profile){
  const spec=profile.miniGameNavigation,result=matching?.miniGameNavigation;
  return spec?.kind==='mini_game_navigation_only'&&spec.anchors?.length===2&&result?.status==='matched_candidate'&&
    result.anchors?.length===2&&result.anchors.every((a,i)=>a.file===spec.anchors[i].file&&
      Number.isFinite(a.matchScore)&&a.matchScore>=spec.anchors[i].minimumScore&&same(a.box,spec.anchors[i].sourceBox));
}
export function normalOrderNavigationConfirmed(matching,profile){
  const spec=profile.normalOrderNavigation,result=matching?.normalOrderNavigation;
  return spec?.kind==='normal_order_navigation_only'&&spec.anchors?.length===2&&result?.status==='matched_candidate'&&
    result.miniGameAbsent===true&&result.miniGameLabel?.file===profile.miniGameNavigation?.anchors[0].file&&
    Number.isFinite(result.miniGameLabel.matchScore)&&result.miniGameLabel.matchScore<profile.miniGameNavigation.anchors[0].minimumScore&&
    same(result.miniGameLabel.box,profile.miniGameNavigation.anchors[0].sourceBox)&&result.anchors?.length===2&&result.anchors.every((a,i)=>a.file===spec.anchors[i].file&&
      Number.isFinite(a.matchScore)&&a.matchScore>=spec.anchors[i].minimumScore&&same(a.box,spec.anchors[i].sourceBox));
}
export function miniGameSelectionTarget(frame,registration,location,sourcePanel='mini_game',sourceGridHash=null){
  if(registration.profile.observationOnly===true||location.status!=='candidate'||
      !(sourcePanel==='mini_game'?location.pinState==='red':['red','green'].includes(location.pinState))||
      location.box.width!==10||location.box.height!==10||location.mapId!==`pin:${location.box.x+5}:${location.box.y+5}`)return null;
  const anchors=registration.profile.anchors.map(a=>a.sourceBox);
  const target=mapNavigationTarget(location,anchors);
  const channelTolerance=sourcePanel==='normal_order'&&frame.provider==='google_play_windows'&&frame.width===1578&&frame.height===1268?8:0;
  Object.assign(target.verification,{maxChangedRatio:0,channelTolerance,criticalRegions:sourcePanel==='mini_game'?
    registration.profile.miniGameNavigation.anchors.map(a=>({field:a.file,box:a.sourceBox})):[{field:'order_grid',box:registration.profile.orderGrid}]});
  target.currentHelicopterSelection={sourcePanel,sourceFrameId:frame.id,sourceHash:frame.evidenceHash,profileHash:registration.hash,
    ...(sourcePanel==='normal_order'?{sourceGridHash}:{})};
  return target;
}
export function validateMiniGameSelectionSource(frame,target){
  const p=helicopterProfile(frame),h=frame.review?.data?.helicopter;
  const location=h?.mapTargets?.find(m=>m.mapId===target.mapId);
  const normal=target.currentHelicopterSelection?.sourcePanel==='normal_order';
  if(!acceptedFacts(frame)||frame.review.reviewedBy!=='program-helicopter'||
      (normal?frame.review.data.order?.kind!=='normal'||!normalOrderNavigationConfirmed(h,p.profile)||!/^[a-f0-9]{64}$/.test(h.selectionGridHash??''):
      frame.review.data.order!==null||h?.miniGameNavigationConfirmed!==true||!miniGameNavigationConfirmed(h,p.profile))||
      !location||!same(target,miniGameSelectionTarget(frame,p,location,normal?'normal_order':'mini_game',h.selectionGridHash)))throw Error('MINI_GAME_NAVIGATION_SOURCE_REQUIRED');
}
export function miniGameSelectionResult(state,action,frame){
  const tag=action?.target?.currentHelicopterSelection,source=state.frames[action?.frameId];
  if(!tag||action.target.kind!=='select_customer'||action.management||state.input!==action.id||
      !['issued','captured'].includes(action.status)||!acceptedFacts(frame)||frame.review.reviewedBy!=='program-helicopter'||
      frame.review.actualKind!=='helicopter'||frame.id===source?.id||frame.evidenceHash===source?.evidenceHash||
      frame.sequence<=source?.sequence||frame.epoch!==action.epoch||action.epoch!==source?.epoch+1||
      frame.sceneId!==action.nextVisit?.visitId||action.nextVisit?.kind!=='helicopter'||
      frame.provider!==source?.provider||frame.serial!==source?.serial||frame.width!==source?.width||frame.height!==source?.height||
      !sameSelectionCaptureTarget(frame.captureTarget,source?.captureTarget)||!Number.isFinite(Date.parse(action.issuedAt))||
      !Number.isFinite(Date.parse(frame.captureStartedAt))||Date.parse(frame.captureStartedAt)<Date.parse(action.issuedAt)+1000||
      action.preflightEvidence?.sourceFrameId!==source?.id||action.preflightEvidence?.actionId!==action.id||
      action.deviceReceipt?.actionId!==action.id||action.deviceReceipt?.commandIssued!==true)return null;
  try{validateMiniGameSelectionSource(source,action.target);}catch{return null;}
  const p=helicopterProfile(frame),o=frame.review.data?.order,h=frame.review.data?.helicopter;
  const signature=orderSignature(o?.needs);
  if(tag.profileHash!==p.hash||source.review.proof?.profileHash!==p.hash||frame.review.proof?.profileHash!==p.hash||
      frame.review.proof?.inputId!==action.id||o?.identityMode!=='product_list'||o.kind!=='normal'||
      h?.miniGameNavigationConfirmed===true||!normalOrderNavigationConfirmed(h,p.profile)||
      tag.sourcePanel==='normal_order'&&(!/^[a-f0-9]{64}$/.test(h.selectionGridHash??'')||h.selectionGridHash===tag.sourceGridHash))return null;
  return {kind:'mini_game_order_selection',confirmed:true,actionId:action.id,profileHash:p.hash,
    sourceFrameId:source.id,sourceHash:source.evidenceHash,preflightId:action.preflightEvidence.id,
    preflightHash:action.preflightEvidence.evidenceHash,frameId:frame.id,evidenceHash:frame.evidenceHash,signature,epoch:frame.epoch};
}
export function selectionCapability(profile){
  const c=profile.navigationSelection;
  if(!c)return null;
  if(profile.observationOnly!==true||c.enabled!==true||c.maxIssuedSelections!==1||
      !/^[a-z0-9-]{1,80}$/.test(c.activationId??''))throw Error('HELICOPTER_SELECTION_CONFIG_INVALID');
  return c;
}
export function mapNavigationTarget(location,anchors){
  const b=location.box;
  const nativeTip=[6,10].includes(b.width)&&b.height===b.width&&location.mapId===`pin:${b.x+b.width/2}:${b.y+b.height/2}`;
  const inset=b.width===6?1:2;
  const core=nativeTip?{x:b.x+inset,y:b.y+inset,width:b.width-inset*2,height:b.height-inset*2}:b;
  return {id:'select:'+location.mapId,kind:'select_customer',type:'tap',box:b,
    verification:{version:1,anchorBoxes:anchors,targetRegions:[core],criticalRegions:[]},mapId:location.mapId};
}
export function selectionTarget(frame,registration,location,signature){
  const c=selectionCapability(registration.profile),b=location.box;
  if(!c||!signature||location.status!=='candidate'||!['red','green'].includes(location.pinState)||
      b.width!==10||b.height!==10||location.mapId!==`pin:${b.x+5}:${b.y+5}`)return null;
  const target=mapNavigationTarget(location,registration.profile.anchors.map(a=>a.sourceBox));
  Object.assign(target.verification,{maxChangedRatio:0,channelTolerance:0,
    criticalRegions:[{field:'order_grid',box:registration.profile.orderGrid}]});
  target.helicopterSelection={activationId:c.activationId,sourceFrameId:frame.id,sourceHash:frame.evidenceHash,
    sourceSignature:signature,profileHash:registration.hash};
  return target;
}
// Count every canonical tagged attempt, including uncertain and pre-input failures.
// A process/release change never renews this fixed activation's one-input budget.
export function selectionAttempts(state,activationId){
  return Object.values(state.actions??{}).filter(a=>a.target?.helicopterSelection?.activationId===activationId);
}
export function selectionResult(state,action,frame){
  const tag=action?.target?.helicopterSelection,source=state.frames[action?.frameId];
  if(!tag||action.target.kind!=='select_customer'||action.management||state.input!==action.id||
      !['issued','captured'].includes(action.status)||!acceptedFacts(source)||!acceptedFacts(frame)||
      source.review.reviewedBy!=='program-helicopter'||!['program-helicopter','GPT'].includes(frame.review.reviewedBy)||
      frame.review.actualKind!=='helicopter'||frame.id===source.id||frame.sequence<=source.sequence||
      frame.epoch!==action.epoch||action.epoch!==source.epoch+1||frame.sceneId!==action.nextVisit?.visitId||
      action.nextVisit?.kind!=='helicopter'||frame.provider!==source.provider||frame.serial!==source.serial||
      frame.width!==source.width||frame.height!==source.height||!sameSelectionCaptureTarget(frame.captureTarget,source.captureTarget)||
      !Number.isFinite(Date.parse(action.issuedAt))||!Number.isFinite(Date.parse(frame.captureStartedAt))||
      Date.parse(frame.captureStartedAt)<Date.parse(action.issuedAt)+1000||
      action.preflightEvidence?.sourceFrameId!==source.id||action.preflightEvidence?.actionId!==action.id||
      action.deviceReceipt?.actionId!==action.id||action.deviceReceipt?.commandIssued!==true)return null;
  const p=helicopterProfile(frame),c=selectionCapability(p.profile),before=orderSignature(source.review.data?.order?.needs),after=orderSignature(frame.review.data?.order?.needs);
  const catalog=JSON.parse(readFileSync(new URL('../reference/product-catalog.json',import.meta.url),'utf8'));
  const known=needs=>Array.isArray(needs)&&needs.every(n=>catalog.items.some(i=>i.itemId===n.itemId&&['crop','farm','factory','feed','island'].includes(i.category)));
  if(!c||tag.activationId!==c.activationId||tag.profileHash!==p.hash||source.review.proof?.profileHash!==p.hash||
      (frame.review.reviewedBy==='program-helicopter'&&(frame.review.proof?.profileHash!==p.hash||frame.review.proof?.inputId!==action.id))||
      tag.sourceFrameId!==source.id||tag.sourceHash!==source.evidenceHash||
      frame.review.data?.order?.identityMode!=='product_list'||
      !known(source.review.data?.order?.needs)||!known(frame.review.data?.order?.needs)||
      !before||before!==tag.sourceSignature||!after||after===before||frame.review.data.order.signature!==after)return null;
  return {kind:'helicopter_selection',confirmed:true,actionId:action.id,activationId:c.activationId,profileHash:p.hash,
    sourceFrameId:source.id,sourceHash:source.evidenceHash,sourceSignature:before,
    preflightId:action.preflightEvidence.id,preflightHash:action.preflightEvidence.evidenceHash,
    frameId:frame.id,evidenceHash:frame.evidenceHash,signature:after,epoch:frame.epoch};
}
export function helicopterProfile(context){
  const path=helicopterProfilePath(context),bytes=readFileSync(path),profile=resolvePercentageProfile(JSON.parse(bytes.toString('utf8')));
  if(context?.provider==='google_play_windows'&&(profile.provider!==context.provider||context.width!==undefined&&context.width!==profile.dimensions.width||context.height!==undefined&&context.height!==profile.dimensions.height))throw Error('HELICOPTER_PROFILE_GEOMETRY_REQUIRED');
  if(profile.provider==='google_play_windows'){
    const transform=gameTransform(profile.coordinateSpace),regions=profile.referenceRegions;
    const same=(actual,fraction)=>{if(JSON.stringify(actual)!==JSON.stringify(nativeBox(fraction,transform)))throw Error('HELICOPTER_COORDINATE_MAP_CHANGED');};
    for(const key of ['sendBox','mapBox','deleteBox','orderGrid','sendVerificationBox','deletionStatusBox'])same(profile[key],regions[key]);
    for(const [i,slot] of profile.slots.entries())for(const key of ['iconBox','quantityBox','checkBox'])same(slot[key],regions.slots[i][key]);
    for(const key of ['anchors','buttons'])for(const [i,entry] of profile[key].entries())same(entry.sourceBox,regions[key][i]);
  }
  if(profile.identityMode!=='product_list'||profile.faces?.length)throw Error('HELICOPTER_ORDER_IDENTITY_REQUIRED');
  for(const entry of [...profile.anchors,...profile.items,...(profile.buttons??[]),...(profile.deliveryCompletion?[profile.deliveryCompletion]:[]),...(profile.miniGameNavigation?.anchors??[]),...(profile.normalOrderNavigation?.anchors??[])]){
    if(entry.file!==entry.file.split(/[\\/]/).at(-1)||digest(readFileSync(join(dirname(path),entry.file)))!==entry.sha256)throw Error('HELICOPTER_ASSET_CHANGED');
    if(entry.identityMaskFile&&(entry.identityMaskFile!==entry.identityMaskFile.split(/[\\/]/).at(-1)||
      digest(readFileSync(join(dirname(path),entry.identityMaskFile)))!==entry.identityMaskHash))throw Error('HELICOPTER_MASK_CHANGED');
  }
  return {profile,hash:digest(bytes)};
}
export function validateHelicopterProof(frame){
  if(frame.review?.reviewedBy!=='program-helicopter')return;
  validateProductDependencies(frame.review.proof?.productRecognition);
  const profile=helicopterProfile(frame);
  if(!acceptedFacts(frame)||frame.review.proof.profileHash!==profile.hash)throw Error('HELICOPTER_PROOF_CHANGED');
  if(frame.review.data?.helicopter?.miniGameNavigationConfirmed===true){
    const h=frame.review.data.helicopter;
    if(!miniGameNavigationConfirmed(h,profile.profile)||frame.review.data.order!==null||frame.review.data.actionResult||
        h.complete!==false||h.checksAgree!==false||frame.review.targets.some(t=>{
          const location=h.mapTargets?.find(m=>m.mapId===t.mapId);
          return !location||!same(t,miniGameSelectionTarget(frame,profile,location));
        }))throw Error('MINI_GAME_NAVIGATION_ONLY');
  }
  const capability=selectionCapability(profile.profile),signature=orderSignature(frame.review.data?.order?.needs);
  const selectionTargets=capability&&signature&&frame.review.targets.every(t=>{
    const location=frame.review.data?.helicopter?.mapTargets?.find(m=>m.mapId===t.mapId);
    return location&&same(t,selectionTarget(frame,profile,location,signature));
  });
  if(profile.profile.observationOnly===true&&((frame.review.targets?.length&&!selectionTargets)||frame.review.data?.actionResult||
      frame.review.data?.order?.ready===true||frame.review.data?.helicopter?.deliveryCompletedConfirmed||
      frame.review.data?.helicopter?.deletionCooldownConfirmed))throw Error('HELICOPTER_OBSERVATION_ONLY');
}
