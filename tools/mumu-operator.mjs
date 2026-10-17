import {createDevice} from './device.mjs';
import { readFileSync,existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {validateBox,digest} from './adb.mjs';
import { navigateReviewed } from './mumu-store.mjs';
import {waitForResultCapture} from './mumu-timing.mjs';
import { readiness } from './mumu-readiness.mjs';
import { itemReference } from './mumu-reference.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {resolvePercentageProfile} from './percentage-profile.mjs';
const profileFile=fileURLToPath(new URL('../reference/mumu-screen-profiles.json',import.meta.url));
import {cropPng} from './png-crop.mjs';
export {cropPng} from './png-crop.mjs';
// pin=false is an entirely read-only inspection, including no crop file creation.
export async function prepareReview(store,{frameId='latest',profileId=null,pin=true,ocr=false,fresh=false,matching=false}={},options={}){
  if(typeof pin!=='boolean' || typeof ocr!=='boolean' || typeof fresh!=='boolean' || typeof matching!=='boolean' || (fresh && (!pin || frameId!=='latest')))throw Error('REVIEW_PACKET_INVALID');
  const initial=store.load();if(pin && (initial.stopCapture || initial.stopReader))throw Error('SESSION_STOPPED');
  let exactId=frameId==='latest'?initial.latestFrameId:frameId;
  if(fresh){
    await waitForResultCapture(store,{sleep:options.sleep,signal:options.signal});
    const context=store.context(),packet=await (options.device??createDevice(context.session)).capture();
    const current=store.load();if(current.stopCapture || current.stopReader)throw Error('SESSION_STOPPED');
    const published=await store.retry(()=>store.publish(packet,context,{preserveForReview:true}));if(!published.accepted)throw Error('FRESH_CAPTURE_NOT_ACCEPTED:'+published.reason);exactId=published.frame.id;
  }else if(pin){
    // Resolve "latest" while pinning it, before reading/decoding its evidence.
    exactId=(await store.retry(()=>store.pinFrame(frameId,{ocr:false}))).id;
  }
  const {frame,image,file,bytes}=store.evidence(exactId);
  let profile=null;
  if(profileId){
    profile=existsSync(profileFile)?resolvePercentageProfile(JSON.parse(readFileSync(profileFile,'utf8'))).profiles.find(p=>p.id===profileId):null;
    if(!profile || profile.width!==frame.width || profile.height!==frame.height || (frame.kind!=='unknown' && frame.kind!==profile.kind))throw Error('SCREEN_PROFILE_MISMATCH');
    for(const r of profile.regions){if(!/^[a-z0-9_-]+$/.test(r.id))throw Error('SCREEN_PROFILE_INVALID');validateBox(r.box,frame.width,frame.height);}
  }
  const ocrRegions=profile?.regions.filter(r=>r.ocr).map(r=>({field:r.id,type:'text',box:r.box}))??[];
  if(pin)await store.retry(()=>store.pinFrame(exactId,{ocr,regions:ocrRegions.length?ocrRegions:null}));
  const regions=[];
  for(const r of profile?.regions??[]){
    let path=null,hash=null;
    if(pin){const dir=join(store.root,'review-crops',exactId);mkdirSync(dir,{recursive:true});path=join(dir,r.id+'.png');const bytes=cropPng(image,r.box);writeFileSync(path,bytes);hash=digest(bytes);}
    regions.push({...r,imagePath:path,evidenceHash:hash,originalFrameId:frame.id});
  }
  let perception=null;
  if(matching){
    const {PerceptionWorker,validatePerception,frameMetadata}=await import('./mumu-perception-bridge.mjs');
    const worker=options.perceptionWorker??new PerceptionWorker();
    try{
      await worker.ready;
      perception=validatePerception(await worker.analyze(frame,bytes,{offline:!pin}),frameMetadata(frame),worker.health);
    }finally{if(!options.perceptionWorker)worker.close();}
  }
  return {schema:1,frameId:frame.id,epoch:frame.epoch,sceneId:frame.sceneId,expectedKind:frame.kind,entityId:frame.entityId,observedAt:frame.observedAt,
    ageMs:store.clock()-Date.parse(frame.observedAt),freshForInput:frame.epoch===store.load().scene.epoch&&inputEvidenceValid(frame,store.clock(),store.load()),
    imagePath:file,evidenceHash:frame.evidenceHash,dimensions:{width:frame.width,height:frame.height},regions,...matching?{perception}: {},
    warnings:profile?.warnings??[],itemReferences:(profile?.referenceItemIds??[]).map(query=>itemReference({query})),policy:readiness(store).policy,ocrRequested:ocr,reviewFields:['quality','actualKind','actualEntityId','targets'],
    notes:['원본/영역을 실제 확인한 GPT만 review한다.','영역 좌표는 과거 참고이며 현재 대상 확인을 대체하지 않는다.','상세 재고 판독은 필요할 때 추가한다.']};
}
// One approved step, not an unverified sequence or an auto retry.
export async function reviewAndAct(store,{review,action,mode='navigation'}={},options={}){
  if(!review || !action || !['navigation','management'].includes(mode) || review.frameId!==action.frameId)throw Error('REVIEW_ACTION_MISMATCH');
  const s=store.load();
  if(s.actions[action.actionId]){
    const previous=await navigateReviewed(store,action,{...options,management:mode==='management'});
    return {issued:false,duplicate:true,actionId:action.actionId,status:previous.action.status,next:'REVIEW_RESULT_BEFORE_NEXT_INPUT'};
  }
  if(s.stopCapture || s.stopReader)throw Error('SESSION_STOPPED');
  const f=s.frames[review.frameId];
  if(!f || f.epoch!==s.scene.epoch || !inputEvidenceValid(f,store.clock(),s) || !inputEvidenceValid({...f,review:{...f.review,data:review.data??{}}},store.clock(),s))throw Error('CURRENT_REVIEWED_FRAME_REQUIRED');
  const result=await store.retry(()=>store.review(review));
  if(result.status!=='accepted')return {issued:false,reason:'SCENE_REVIEW_MISMATCH',review:result.status};
  const begun=await navigateReviewed(store,action,{...options,management:mode==='management'});
  return {issued:!begun.duplicate && begun.status==='issued',duplicate:!!begun.duplicate,actionId:action.actionId,status:begun.action?.status??begun.status,next:'REVIEW_RESULT_BEFORE_NEXT_INPUT'};
}

// On-demand candidate preparation. Workers run outside all source locks.
export async function prepareContents(store,{frameId='latest',layoutId,pin=true,offline=false}={},options={}){
  if(typeof pin!=='boolean'||typeof offline!=='boolean'||!layoutId||pin&&offline)throw Error('CONTENTS_PACKET_INVALID');
  const initial=store.load();if(pin&&(initial.stopCapture||initial.stopReader))throw Error('SESSION_STOPPED');
  const {PerceptionWorker,RapidOcrWorker,DEFAULT_LAYOUTS}=await import('./mumu-perception-bridge.mjs');
  const {readContents}=await import('./mumu-contents.mjs');
  const ticket=store.marketTicket();
  const exactId=pin?(await store.retry(()=>store.pinFrame(frameId,{ocr:false}))).id:
    frameId==='latest'?store.load().latestFrameId:frameId;
  const evidence=store.evidence(exactId);
  const matcher=options.matcher??new PerceptionWorker({layouts:DEFAULT_LAYOUTS}),ocr=options.ocr??new RapidOcrWorker();
  try{
    const contents=await readContents(evidence.frame,evidence.bytes,{matcher,ocr,layoutId,offline,clock:store.clock});
    let stored=false;
    if(pin&&contents.scene.kind==='market'&&contents.status==='candidate'){
      await store.retry(()=>store.recordMarketContents(contents,ticket));stored=true;
    }
    return {contents,stored,ticket:stored?store.marketTicket():ticket,executionAllowed:false};
  }finally{if(!options.matcher)matcher.close();if(!options.ocr)ocr.close();}
}
