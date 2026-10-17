import {clearObservationWait} from './mumu-observation-wait-lifecycle.mjs';
import {productEvidenceLocation,writeEvidence,completeProductEvidence,saveProductEvidence as save,createProductEvidence,loadProductEvidence,evidenceFilesMatch} from './mumu-product-evidence-repository.mjs';
export {completeProductEvidence} from './mumu-product-evidence-repository.mjs';
import {productEvidenceTransition} from './mumu-product-evidence-state.mjs';
// Awaited by the existing capture owner. No separate capture loop or game input.
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash} from './mumu-evidence.mjs';
import {helicopterProfile} from './mumu-helicopter-proof.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
import {resultCaptureDueAt} from './mumu-timing.mjs';
import {inputGeometry} from './percentage-coordinates.mjs';
import {cropPng} from './png-crop.mjs';
import {HELICOPTER_INFO_READER,helicopterInfoRegistration,unknownProductCandidates,productEvidenceKey,infoTarget,helicopterInfoRecoveryVisit,restartedProductInspection,productIdentityRegions,helicopterInspectionProof,validateHelicopterInfoSource,sameHelicopterInfoNameRegion,helicopterInfoNameEquivalence} from './mumu-helicopter-info-proof.mjs';

const hash=bytes=>digest(bytes);
const frameRef=f=>({frameId:f.id,evidenceHash:f.evidenceHash,sequence:f.sequence,epoch:f.epoch,observedAt:f.observedAt});
function review(frame,state,registration,data,targets,role){
  const output={reviewedBy:HELICOPTER_INFO_READER,quality:{gameVisible:true,occluded:false},actualKind:'helicopter',actualEntityId:null,
    data:{...(frame.review?.data??{}),order:null,helicopterProductInfo:data},targets};
  output.proof={schema:'program-helicopter-info-1',role,frameId:frame.id,evidenceHash:frame.evidenceHash,
    profileHash:helicopterProfile(frame).hash,infoProfileHash:registration.hash,inputId:state.input,
    invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(output)};
  return output;
}
function clickPercent(frame,box,session){
  const v=inputGeometry(session,frame).viewport;
  if(!v)throw Error('HELICOPTER_INFO_VIEWPORT_REQUIRED');
  return {unit:'fraction',space:'game',viewport:v,x:(box.x+box.width/2-v.x)/v.width,y:(box.y+box.height/2-v.y)/v.height};
}
async function issue(c,frame,target){
  const state=c.guard().state;
  if(state.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');
  const actionId=generatedActionId(state,{frameId:frame.id,targetId:target.id,kind:'i'},()=>`heli-info:${frame.sequence}:${target.helicopterProductInfo.mode}`);
  c.navigationActionId=actionId;
  const nextVisit={visitId:actionId+'-result',kind:'helicopter'};
  const guard=settling=>{const s=c.guard({phase:settling?'owned-input':'observe'}).state;if(s.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');
    // Store admission and recovery pre-input already run this same check.
    if(settling&&target.helicopterProductInfo.mode==='dismiss'&&!frame.review.data.helicopterProductInfo.recoveryOf)
      validateHelicopterInfoSource(s,frame,target,nextVisit,{evidence:id=>c.store.evidence(id),pendingActionId:actionId});};
  await navigateReviewed(c.store,{actionId,frameId:frame.id,targetId:target.id,nextVisit},
    {device:c.device,beforeBegin:()=>guard(false),beforeInputGuard:()=>guard(true)});
  return actionId;
}
async function inspectionProof(c,opened,original,result,{restart=false,owned=false}={}){
  const before=await c.workers.matcher.analyze(original.frame,original.bytes,{offline:true,helicopterInfo:true});
  const state=c.guard({phase:owned?'owned-input':'observe'}).state,registration=helicopterInfoRegistration();
  if(before.status!=='candidate'||before.frameId!==original.frame.id||before.evidenceHash!==original.frame.evidenceHash||
    before.productInfoProfileHash!==registration.hash||before.productInfo?.popups?.length!==0)throw Error('HELICOPTER_INFO_PRECLICK_POPUP_PRESENT');
  return helicopterInspectionProof(state,opened,result,{frameId:original.frame.id,evidenceHash:original.frame.evidenceHash,
    infoProfileHash:registration.hash,popupCount:0},{restart});
}
export async function startUnknownProductCollection(c,frame,observed){
  if(!c.currentMode||c.store.load().input||c.transports?.helicopter?.plan)return false;
  const candidates=unknownProductCandidates(frame,observed);
  if(!candidates.length)return false;
  const e=c.store.evidence(frame.id),registration=helicopterInfoRegistration(),profile=helicopterProfile(frame).profile;
  const evidenceRoot=c.productEvidenceRoot??registration.config.evidenceRoot;
  for(const slot of candidates){
    const product=productEvidenceKey(frame,e.image,slot.slotId,profile);
    if(completeProductEvidence(evidenceRoot,product.key)||c.failedProductEvidence?.has(product.key))continue;
    c.guard();
    const info=await c.workers.matcher.analyze(frame,e.bytes,{offline:true,helicopterInfo:true});
    if(info.status!=='candidate'||info.productInfoProfileHash!==registration.hash||info.productInfo.popups.length)throw Error('HELICOPTER_INFO_SOURCE_REQUIRED');
    const tag={mode:'open',slotId:slot.slotId,evidenceKey:product.key,sourceFrameId:frame.id,sourceHash:frame.evidenceHash};
    const target=infoTarget(frame,tag),{id,directory}=productEvidenceLocation(evidenceRoot,product.key,frame.sequence);
    const record={directory,sourceFrameId:frame.id,slotId:slot.slotId,evidenceKey:product.key,
      gridHash:observed.matching.selectionGridHash,
      metadata:{schema:1,evidenceId:id,evidenceKey:product.key,status:'pending',registrationStatus:'pending_ai',itemId:null,
        createdAt:new Date(c.store.clock()).toISOString(),scope:{transport:'helicopter',provider:frame.provider,width:frame.width,height:frame.height},
        source:frameRef(frame),slotId:slot.slotId,cropBox:product.box,identityRegions:product.regions,
        checkState:typeof slot.checkPresent==='boolean'?(slot.checkPresent?'present':'absent'):'unknown',
        percentageCrop:{unit:'fraction',space:'registered_capture',x:product.box.x/frame.width,y:product.box.y/frame.height,width:product.box.width/frame.width,height:product.box.height/frame.height},
        click:clickPercent(frame,target.box,c.store.load().session),files:{'item.png':hash(product.bytes),'source.png':hash(e.bytes)}}};
    try{
      createProductEvidence(record,product.bytes,e.bytes);
    }catch(error){
      c.failedProductEvidence??=new Set();c.failedProductEvidence.add(product.key);
      c.update('recognizing','HELICOPTER_INFO_SAVE_FAILED',{productEvidenceError:error.message});continue;
    }
    const r=review(frame,c.guard().state,registration,{...tag,gridHash:record.gridHash},[target],'source');
    await c.store.retry(()=>c.store.review({frameId:frame.id,...r,programToken:PROGRAM_REVIEW_TOKEN}));
    c.helicopterInfo=record;
    try{
      record.metadata.openActionId=await issue(c,c.store.load().frames[frame.id],target);
      record.metadata.click=c.store.load().actions[record.metadata.openActionId].percentageCommand;save(record);
    }
    catch(error){record.metadata=productEvidenceTransition(record.metadata,'failed',{reason:error.message});try{save(record);}catch{}throw error;}
    c.update('collecting_product','HELICOPTER_PRODUCT_INFO_RESULT_REQUIRED',{productEvidence:{id,slotId:slot.slotId,status:'pending'}});
    return true;
  }
  return false;
}
export async function recoverRejectedProductDismissal(c,frame){
  const state=c.store.load(),failed=Object.values(state.actions).at(-1),tag=failed?.target?.helicopterProductInfo;
  if(!state.input&&c.currentMode&&restartedProductInspection(state,frame,failed))return resumeRestartedInspection(c,frame,failed);
  if(state.input||!c.currentMode||tag?.mode!=='dismiss'||failed.status!=='rejected_before_input'||failed.inputAttempted!==false)return null;
  const previous=c.store.evidence(failed.frameId);
  if(previous.frame.review?.data?.helicopterProductInfo?.recoveryOf)return null;
  const opened=state.actions[previous.frame.review?.data?.helicopterProductInfo?.actionId];
  if(!helicopterInfoRecoveryVisit(state,frame,opened))return null;
  c.busy=true;
  try{
    c.guard();c.workers??=c.workersFactory();
    const e=c.store.evidence(frame.id),registration=helicopterInfoRegistration(),original=c.store.evidence(tag.sourceFrameId);
    const info=await c.workers.matcher.analyze(frame,e.bytes,{offline:true,helicopterInfo:true});
    c.guard();
    // The user may already have closed the tooltip or left this panel. Let the
    // ordinary current-screen observer handle that without issuing a recovery.
    if(info.status!=='candidate'||!info.productInfo?.popups?.length)return null;
    const before=await c.workers.matcher.analyze(previous.frame,previous.bytes,{offline:true,helicopterInfo:true});
    c.guard();
    const popup=info.productInfo?.popups?.[0],oldPopup=before.productInfo?.popups?.[0];
    if(info.status!=='candidate'||before.status!=='candidate'||info.productInfoProfileHash!==registration.hash||before.productInfoProfileHash!==registration.hash||
       info.productInfo.popups.length!==1||before.productInfo.popups.length!==1)throw Error('HELICOPTER_INFO_RECOVERY_POPUP_CHANGED');
    const inspection=await inspectionProof(c,opened,original,previous.frame);
    let nameEquivalence=null;
    if(!sameHelicopterInfoNameRegion(previous.image,e.image,oldPopup.nameBox,popup.nameBox)){
      nameEquivalence=helicopterInfoNameEquivalence(registration,{frame:previous.frame,image:previous.image,box:oldPopup.nameBox},
        {frame,image:e.image,box:popup.nameBox},inputGeometry(state.session,frame).viewport);
      if(!nameEquivalence)throw Error('HELICOPTER_INFO_RECOVERY_POPUP_CHANGED');
    }
    const evidenceRoot=c.productEvidenceRoot??registration.config.evidenceRoot;
    const record=loadProductEvidence(evidenceRoot,tag,original.frame);
    if(record.metadata.source.evidenceHash!==tag.sourceHash||record.metadata.evidenceKey!==tag.evidenceKey||
       record.metadata.info?.frameId!==failed.frameId||!evidenceFilesMatch(record,['info.png']))throw Error('HELICOPTER_INFO_RECOVERY_EVIDENCE_REQUIRED');
    record.metadata=productEvidenceTransition(record.metadata,'recovery',{recovery:{rejectedActionId:failed.id,source:frameRef(frame)}});save(record);
    const target=infoTarget(frame,tag),data={...tag,popup,inspection,recoveryOf:failed.id,...(nameEquivalence?{nameEquivalence}:{})};
    const r=review(frame,c.guard().state,registration,data,[target],'source');
    await c.store.retry(()=>c.store.review({frameId:frame.id,...r,programToken:PROGRAM_REVIEW_TOKEN}));
    c.helicopterInfo=record;record.metadata.dismissActionId=await issue(c,c.store.load().frames[frame.id],target);save(record);
    return c.update('collecting_product','HELICOPTER_PRODUCT_INFO_DISMISS_REQUIRED');
  }catch(error){return c.update('hold',error.message);}
  finally{c.busy=false;}
}
async function resumeRestartedInspection(c,frame,opened){
  c.busy=true;
  try{
    c.guard();c.workers??=c.workersFactory();
    const tag=opened.target.helicopterProductInfo,e=c.store.evidence(frame.id),original=c.store.evidence(tag.sourceFrameId),registration=helicopterInfoRegistration();
    const info=await c.workers.matcher.analyze(frame,e.bytes,{offline:true,helicopterInfo:true});c.guard();
    if(info.status!=='candidate'||!info.productInfo?.popups?.length)return null;
    const profile=helicopterProfile(original.frame).profile,popup=info.productInfo.popups[0];
    if(info.productInfoProfileHash!==registration.hash||info.productInfo.popups.length!==1)throw Error('HELICOPTER_INFO_RESTART_POPUP_REQUIRED');
    const inspection=await inspectionProof(c,opened,original,frame,{restart:true});
    // Compare only the current item rectangles outside the popup body.
    const visible=productIdentityRegions(profile,tag.slotId).flatMap(b=>{
      const p=popup.box,l=Math.max(b.x,p.x),t=Math.max(b.y,p.y),r=Math.min(b.x+b.width,p.x+p.width),d=Math.min(b.y+b.height,p.y+p.height);
      if(l>=r||t>=d)return [b];
      return [{x:b.x,y:b.y,width:b.width,height:t-b.y},{x:b.x,y:d,width:b.width,height:b.y+b.height-d},
        {x:b.x,y:t,width:l-b.x,height:d-t},{x:r,y:t,width:b.x+b.width-r,height:d-t}];
    }).filter(b=>b.width>=16&&b.height>=16);
    if(!visible.length||visible.some(b=>hash(cropPng(e.image,b))!==hash(cropPng(original.image,b))))throw Error('HELICOPTER_INFO_RESTART_PRODUCT_CHANGED');
    const {directory}=productEvidenceLocation(c.productEvidenceRoot??registration.config.evidenceRoot,tag.evidenceKey,original.frame.sequence);
    const record=loadProductEvidence(c.productEvidenceRoot??registration.config.evidenceRoot,tag,original.frame);
    if(original.frame.evidenceHash!==tag.sourceHash||record.metadata.source.evidenceHash!==tag.sourceHash||record.metadata.evidenceKey!==tag.evidenceKey||
      !evidenceFilesMatch(record,['item.png','source.png']))throw Error('HELICOPTER_INFO_RESTART_EVIDENCE_REQUIRED');
    writeEvidence(join(directory,'info.png'),e.bytes);
    record.metadata=productEvidenceTransition(record.metadata,'captured',{hash:hash(e.bytes),info:{...frameRef(frame),popup,observedAfterRestart:true},clearReason:true});
    record.metadata.restartObservation={supersededOpenActionId:opened.id,incarnation:c.store.load().orderDemandStartup.currentIncarnation};save(record);
    const data={...tag,mode:'dismiss',popup,inspection,restartOf:opened.id},target=infoTarget(frame,data),r=review(frame,c.guard().state,registration,data,[target],'source');
    await c.store.retry(()=>c.store.review({frameId:frame.id,...r,programToken:PROGRAM_REVIEW_TOKEN}));c.helicopterInfo=record;
    record.metadata.dismissActionId=await issue(c,c.store.load().frames[frame.id],target);save(record);
    return c.update('collecting_product','HELICOPTER_PRODUCT_INFO_DISMISS_REQUIRED');
  }catch(error){return c.update('hold',error.message);}
  finally{c.busy=false;}
}
export async function handleUnknownProductResult(c,frame){
  const initial=c.store.load(),action=initial.actions[initial.input];
  if(!action?.target?.helicopterProductInfo)return null;
  c.busy=true;
  try{
    c.guard({phase:'owned-input'});
    if(!['issued','captured'].includes(action.status))throw Error('HELICOPTER_INFO_INPUT_UNRESOLVED');
    const due=resultCaptureDueAt(action);
    if(due===null||!Number.isFinite(Date.parse(frame.captureStartedAt))||Date.parse(frame.captureStartedAt)<due)
      return c.update('collecting_product','HELICOPTER_PRODUCT_INFO_RESULT_REQUIRED');
    const tag=action.target.helicopterProductInfo,registration=helicopterInfoRegistration(),e=c.store.evidence(frame.id),original=c.store.evidence(tag.sourceFrameId);
    const evidenceRoot=c.productEvidenceRoot??registration.config.evidenceRoot;
    if(original.frame.evidenceHash!==tag.sourceHash||initial.latestFrameId!==frame.id||frame.epoch!==action.epoch)throw Error('HELICOPTER_INFO_CONTEXT_CHANGED');
    const {id}=productEvidenceLocation(evidenceRoot,tag.evidenceKey,original.frame.sequence);
    const record=c.helicopterInfo??loadProductEvidence(evidenceRoot,tag,original.frame);
    c.helicopterInfo=record;
    c.workers??=c.workersFactory();
    const info=await c.workers.matcher.analyze(frame,e.bytes,{offline:true,helicopterInfo:true});
    c.guard({phase:'owned-input'});
    if(info.status!=='candidate'||info.productInfoProfileHash!==registration.hash)throw Error(info.reason??'HELICOPTER_INFO_RESULT_REQUIRED');
    let targets=[];const data={...tag,actionId:action.id,frameId:frame.id,confirmed:true};
    if(tag.mode==='open'){
      const popups=info.productInfo.popups;
      if(popups.length!==1)throw Error('HELICOPTER_INFO_POPUP_REQUIRED');
      data.inspection=await inspectionProof(c,action,original,frame,{owned:true});
      data.popup=popups[0];targets=[infoTarget(frame,{...tag,mode:'dismiss'})];
      try{
        writeEvidence(join(record.directory,'info.png'),e.bytes);
        record.metadata=productEvidenceTransition(record.metadata,'captured',{hash:hash(e.bytes),info:{...frameRef(frame),popup:popups[0],openActionId:action.id}});save(record);
      }catch(error){record.saveError=error.message;record.metadata=productEvidenceTransition(record.metadata,'failed',{reason:error.message});}
    }else{
      if(info.productInfo.popups.length)throw Error('HELICOPTER_INFO_DISMISS_REQUIRED');
      const normal=await c.workers.matcher.analyze(frame,e.bytes,{offline:true,helicopter:true});
      c.guard({phase:'owned-input'});
      if(normal.status!=='candidate'||normal.normalOrderNavigation?.status!=='matched_candidate'||!record.gridHash||normal.selectionGridHash!==record.gridHash)
        throw Error('HELICOPTER_INFO_ORDER_RETURN_REQUIRED');
      data.returnedGridHash=normal.selectionGridHash;
    }
    const r=review(e.frame,c.store.load(),registration,data,targets,'result');
    await c.store.retry(()=>c.store.pinFrame(frame.id,{ocr:false}));
    await c.store.retry(()=>c.store.review({frameId:frame.id,...r,programToken:PROGRAM_REVIEW_TOKEN}));
    if(c.store.load().input)throw Error('HELICOPTER_INFO_RESULT_UNSETTLED');
    c.navigationActionId=null;
    if(tag.mode==='open'){
      record.metadata.dismissActionId=await issue(c,c.store.load().frames[frame.id],targets[0]);
      try{save(record);}catch(error){record.saveError=error.message;}
      return c.update('collecting_product','HELICOPTER_PRODUCT_INFO_DISMISS_REQUIRED');
    }
    record.metadata=productEvidenceTransition(record.metadata,'returned',{returned:{...frameRef(frame),confirmed:true,dismissActionId:action.id},saveError:record.saveError,completedAt:new Date(c.store.clock()).toISOString()});
    try{save(record);}catch(error){record.metadata=productEvidenceTransition(record.metadata,'failed',{reason:error.message});}
    if(record.metadata.status!=='complete'){c.failedProductEvidence??=new Set();c.failedProductEvidence.add(tag.evidenceKey);}
    c.helicopterInfo=null;c.lastKey=null;c.passiveObservationKey=null;clearObservationWait(c);
    return c.update('recognizing',record.metadata.status==='complete'?'HELICOPTER_PRODUCT_EVIDENCE_COLLECTED':'HELICOPTER_INFO_SAVE_FAILED',
      {productEvidence:{id,slotId:tag.slotId,status:record.metadata.status}});
  }catch(error){
    if(c.helicopterInfo){c.helicopterInfo.metadata=productEvidenceTransition(c.helicopterInfo.metadata,'failed',{reason:error.message});try{save(c.helicopterInfo);}catch{}}
    return c.update('hold',error.message);
  }finally{c.busy=false;}
}
