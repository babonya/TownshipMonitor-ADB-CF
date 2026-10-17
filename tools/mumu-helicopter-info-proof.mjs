// Screenshot evidence authorizes only one product inspection or title dismissal.
import {readFileSync} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng,validateBox} from './adb.mjs';
import {cropPng} from './png-crop.mjs';
import {acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
import {helicopterProfile,sameSelectionCaptureTarget} from './mumu-helicopter-proof.mjs';
import {inputGeometry,commandForTarget,resolvePercentageCommand} from './percentage-coordinates.mjs';
import {POST_INPUT_DELAY_MS} from './mumu-timing.mjs';
import {loadHelicopterNameTemplates,sameHelicopterInfoNameRegion,helicopterInfoNameEquivalence,validateHelicopterNameEquivalence} from './mumu-helicopter-info-names.mjs';
export {sameHelicopterInfoNameRegion,helicopterInfoNameEquivalence} from './mumu-helicopter-info-names.mjs';
export const HELICOPTER_INFO_READER='program-helicopter-info';
const configPath=fileURLToPath(new URL('../reference/helicopter-product-info/profile.json',import.meta.url));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function helicopterInfoRegistration(){
  const raw=readFileSync(configPath),config=JSON.parse(raw);
  if(config.schema!==1||typeof config.enabled!=='boolean'||!isAbsolute(config.evidenceRoot)||!Array.isArray(config.markers)||!config.markers.length)throw Error('HELICOPTER_INFO_CONFIG_INVALID');
  for(const spec of config.markers){if(spec.file!==spec.file.split(/[\\/]/).at(-1)||digest(readFileSync(join(dirname(configPath),spec.file)))!==spec.sha256)throw Error('HELICOPTER_INFO_ASSET_CHANGED');}
  return {config,hash:digest(raw),nameTemplates:loadHelicopterNameTemplates(config,dirname(configPath))};
}
export function productCropBox(profile,slotId){
  const slot=profile.slots.find(s=>s.slotId===slotId),shared=profile.sharedProductRecognition?.slots?.find(s=>s.slotId===slotId);
  if(!slot)throw Error('HELICOPTER_INFO_SLOT_REQUIRED');
  const b=shared?.box??slot.iconBox,bottom=Math.min(b.y+b.height,slot.quantityBox.y);
  const crop={...b,height:bottom-b.y};
  if(crop.width<16||crop.height<16)throw Error('HELICOPTER_INFO_PRODUCT_REGION_REQUIRED');
  return crop;
}
// Preserve the complete item evidence; exclude only the intersecting check from
// identity/preflight regions rather than throwing away the whole lower half.
export function productIdentityRegions(profile,slotId){
  const b=productCropBox(profile,slotId),check=profile.slots.find(s=>s.slotId===slotId).checkBox;
  const left=Math.max(b.x,check.x),top=Math.max(b.y,check.y),right=Math.min(b.x+b.width,check.x+check.width),bottom=Math.min(b.y+b.height,check.y+check.height);
  if(left>=right||top>=bottom)return [b];
  return [
    {x:b.x,y:b.y,width:b.width,height:top-b.y},
    {x:b.x,y:bottom,width:b.width,height:b.y+b.height-bottom},
    {x:b.x,y:top,width:left-b.x,height:bottom-top},
    {x:right,y:top,width:b.x+b.width-right,height:bottom-top}
  ].filter(r=>r.width>0&&r.height>0);
}
export function unknownProductCandidates(frame,observed){
  const {config}=helicopterInfoRegistration();
  if(!config.enabled||frame.provider!=='google_play_windows'||frame.width!==config.dimensions.width||frame.height!==config.dimensions.height||
      observed.matching?.normalOrderNavigation?.status!=='matched_candidate'||observed.review?.actualKind!=='helicopter')return [];
  return (observed.matching.slots??[]).filter(slot=>slot.status==='unknown'&&slot.productPresent===true&&
    observed.review.data.order?.needs?.some(n=>n.slotId===slot.slotId&&n.itemId===null));
}
export function productEvidenceKey(frame,image,slotId,profile=helicopterProfile(frame).profile){
  const box=productCropBox(profile,slotId),bytes=cropPng(image,box),regions=productIdentityRegions(profile,slotId);
  return {box,bytes,regions,key:digest(Buffer.from(JSON.stringify({provider:frame.provider,width:frame.width,height:frame.height,
    cropWidth:box.width,cropHeight:box.height,regions:regions.map(r=>({x:r.x-box.x,y:r.y-box.y,width:r.width,height:r.height,imageHash:digest(cropPng(image,r))}))})))};
}
export function infoTarget(frame,{mode,slotId,evidenceKey,sourceFrameId,sourceHash},profile=helicopterProfile(frame).profile){
  const slot=profile.slots.find(s=>s.slotId===slotId),title=profile.anchors.find(a=>a.file==='title.png');
  if(!slot||!title||!['open','dismiss'].includes(mode)||!/^[a-f0-9]{64}$/.test(evidenceKey??'')||!sourceFrameId||!/^[a-f0-9]{64}$/.test(sourceHash??''))throw Error('HELICOPTER_INFO_TARGET_INVALID');
  const b=mode==='open'?productCropBox(profile,slotId):title.sourceBox;
  validateBox(b,frame.width,frame.height);
  return {id:`helicopter-info:${mode}:${slotId}`,kind:mode==='open'?'inspect_item':'close_panel',type:'tap',box:b,
    helicopterProductInfo:{mode,slotId,evidenceKey,sourceFrameId,sourceHash},
    verification:{version:1,anchorBoxes:[title.sourceBox],targetRegions:[b],channelTolerance:0,maxChangedRatio:0}};
}
// A sole popup belongs to the proved inspection input, never to its silhouette.
export function helicopterInspectionProof(state,opened,result,noPopup,{restart=false}={}){
  const source=state.frames[opened?.frameId],tag=opened?.target?.helicopterProductInfo,receipt=opened?.deviceReceipt;
  const registration=helicopterInfoRegistration(),issued=Date.parse(opened?.issuedAt),captured=Date.parse(result?.captureStartedAt);
  if(!source||!result||tag?.mode!=='open'||source.id!==tag.sourceFrameId||source.evidenceHash!==tag.sourceHash||
    !acceptedFacts(source)||source.review.reviewedBy!==HELICOPTER_INFO_READER||source.review.data.helicopterProductInfo?.mode!=='open'||
    !same(opened.target,infoTarget(source,tag))||!source.review.targets.some(t=>same(t,opened.target))||
    opened.coordinateSource?.frameId!==source.id||opened.coordinateSource?.evidenceHash!==source.evidenceHash||
    opened.inputAttempted!==true||receipt?.actionId!==opened.id||receipt.status!=='issued'||receipt.commandIssued!==true||
    !Number.isFinite(issued)||!Number.isFinite(captured)||captured<issued+POST_INPUT_DELAY_MS||
    !Number.isFinite(Date.parse(result.observedAt))||Date.parse(result.observedAt)<captured||
    !Number.isFinite(Date.parse(source.observedAt))||!Number.isFinite(Date.parse(receipt.startedAt))||Date.parse(source.observedAt)>Date.parse(receipt.startedAt)||
    !Number.isFinite(Date.parse(receipt.completedAt))||Date.parse(receipt.startedAt)>Date.parse(receipt.completedAt)||Date.parse(receipt.completedAt)>issued||
    opened.epoch!==source.epoch+1||result.width!==source.width||result.height!==source.height||
    result.sequence<=source.sequence||result.provider!==source.provider||result.serial!==source.serial||!sameSelectionCaptureTarget(result.captureTarget,source.captureTarget)||
    !same(noPopup,{frameId:source.id,evidenceHash:source.evidenceHash,infoProfileHash:registration.hash,popupCount:0}))throw Error('HELICOPTER_INFO_CAUSAL_PROOF_REQUIRED');
  const geometry=inputGeometry(state.session,source),expected=commandForTarget(opened.target,null,geometry);
  resolvePercentageCommand(opened.percentageCommand,geometry,opened.command);
  if(!same(opened.command,expected.command))throw Error('HELICOPTER_INFO_CAUSAL_CLICK_CHANGED');
  if(restart){if(!restartedProductInspection(state,result,opened))throw Error('HELICOPTER_INFO_RESTART_NOT_SAFE');}
  else if(!['issued','captured','verified'].includes(opened.status)||opened.epoch!==result.epoch||opened.nextVisit?.kind!=='helicopter'||
    opened.nextVisit.visitId!==result.sceneId||opened.status==='verified'&&opened.resultFrameId!==result.id)throw Error('HELICOPTER_INFO_CAUSAL_RESULT_CHANGED');
  return {schema:1,actionId:opened.id,restart,source:noPopup,
    inputHash:digest(Buffer.from(JSON.stringify({target:opened.target,command:opened.command,percentageCommand:opened.percentageCommand,
      coordinateSource:opened.coordinateSource,receipt,issuedAt:opened.issuedAt,epoch:opened.epoch,nextVisit:opened.nextVisit}))),
    result:{frameId:result.id,evidenceHash:result.evidenceHash,epoch:result.epoch,sceneId:result.sceneId,sequence:result.sequence,captureStartedAt:result.captureStartedAt}};
}

function validateInspectionState(state,frame,{evidence=null,pendingActionId=null}={}){
  const data=frame.review.data.helicopterProductInfo,proof=data.inspection,opened=state.actions[proof?.actionId],result=state.frames[proof?.result?.frameId];
  // The pending dismissal is the sole later action; omit it only while checking
  // the already-proved restart observation that preceded its admission.
  let sourceState=state;
  if(pendingActionId){
    const pending=state.actions[pendingActionId];
    if(state.input!==pendingActionId||pending?.status!=='pending'||pending.frameId!==frame.id||pending.epoch!==frame.epoch+1||state.scene.epoch!==pending.epoch)throw Error('HELICOPTER_INFO_CAUSAL_CONTEXT_CHANGED');
    sourceState={...state,input:null,scene:{...state.scene,epoch:frame.epoch},actions:Object.fromEntries(Object.entries(state.actions).filter(([id])=>id!==pendingActionId))};
  }
  if(!proof||typeof evidence!=='function'||!opened||!result||!same({...opened.target.helicopterProductInfo,mode:data.mode},
    {mode:data.mode,slotId:data.slotId,evidenceKey:data.evidenceKey,sourceFrameId:data.sourceFrameId,sourceHash:data.sourceHash})||
    !same(proof,helicopterInspectionProof(sourceState,opened,result,proof.source,{restart:proof.restart})))throw Error('HELICOPTER_INFO_CAUSAL_PROOF_CHANGED');
  const original=state.frames[data.sourceFrameId];
  for(const bound of [original,result,frame]){
    const e=evidence(bound.id);
    if(e?.frame?.id!==bound.id||e.frame.evidenceHash!==bound.evidenceHash||digest(e.bytes)!==bound.evidenceHash)throw Error('HELICOPTER_INFO_CAUSAL_EVIDENCE_CHANGED');
    if(bound===original&&productEvidenceKey(original,decodePng(e.bytes),data.slotId).key!==data.evidenceKey)throw Error('HELICOPTER_INFO_CAUSAL_SLOT_CHANGED');
  }
}
export function validateHelicopterInfoProof(frame){
  if(frame.review?.reviewedBy!==HELICOPTER_INFO_READER)return;
  const r=frame.review,p=r.proof,registration=helicopterInfoRegistration(),profile=helicopterProfile(frame);
  if(!acceptedFacts(frame)||r.actualKind!=='helicopter'||r.actualEntityId!==null||p.profileHash!==profile.hash||p.infoProfileHash!==registration.hash||
      p.reviewHash!==reviewFactHash(r)||!['source','result'].includes(p.role)||!r.data.helicopterProductInfo||r.data.order!==null||r.data.actionResult!==undefined)throw Error('HELICOPTER_INFO_PROOF_CHANGED');
  const data=r.data.helicopterProductInfo;
  if(Object.hasOwn(data,'nameEquivalence')){
    if(p.role!=='source'||data.mode!=='dismiss'||!data.recoveryOf||data.restartOf)throw Error('HELICOPTER_INFO_NAME_PROOF_CHANGED');
    validateHelicopterNameEquivalence(data.nameEquivalence,registration,frame,data.popup);
  }
  const targetMode=p.role==='source'?data.mode:data.mode==='open'?'dismiss':null;
  if(targetMode==='dismiss'){
    const b=data.popup?.box,n=data.popup?.nameBox;
    if(!b||!n||n.width<16||n.height<16||n.x<b.x||n.y<b.y||n.x+n.width>b.x+b.width||n.y+n.height>b.y+b.height)throw Error('HELICOPTER_INFO_NAME_REGION_REQUIRED');
    validateBox(n,frame.width,frame.height);
    const inspection=data.inspection;
    if(!inspection||inspection.schema!==1||typeof inspection.actionId!=='string'||typeof inspection.restart!=='boolean'||
      !/^[a-f0-9]{64}$/.test(inspection.inputHash??'')||inspection.source?.popupCount!==0||inspection.source.frameId!==data.sourceFrameId||
      inspection.source.evidenceHash!==data.sourceHash||inspection.source.infoProfileHash!==registration.hash||!inspection.result?.frameId||
      !/^[a-f0-9]{64}$/.test(inspection.result.evidenceHash??'')||(!data.recoveryOf&&
      (inspection.result.frameId!==frame.id||inspection.result.evidenceHash!==frame.evidenceHash))||
      (data.restartOf?inspection.restart!==true||inspection.actionId!==data.restartOf:inspection.restart!==false)||
      (p.role==='result'&&inspection.actionId!==data.actionId))throw Error('HELICOPTER_INFO_CAUSAL_PROOF_REQUIRED');
  }
  if(r.targets.length!==(targetMode?1:0)||r.targets.some(t=>!same(t,infoTarget(frame,{...data,mode:targetMode},profile.profile))))throw Error('HELICOPTER_INFO_TARGET_CHANGED');
  if(p.role==='source'&&r.targets.length!==1||p.role==='result'&&(data.confirmed!==true||data.frameId!==frame.id||data.actionId!==p.inputId))throw Error('HELICOPTER_INFO_RESULT_REQUIRED');
}
export function helicopterInfoRecoveryVisit(state,frame,opened){
  if(opened?.status!=='verified'||opened.target?.helicopterProductInfo?.mode!=='open'||
     !['helicopter','unknown'].includes(state.scene.kind)||frame.sceneId!==state.scene.id||frame.epoch!==state.scene.epoch)return false;
  if(state.scene.kind==='helicopter'&&state.scene.id===opened.nextVisit?.visitId)return true;
  const marker=state.orderDemandStartup,invalidation=state.observationInvalidation;
  return !!marker?.currentIncarnation&&state.scene.id==='restart:'+marker.currentIncarnation&&
    invalidation?.reason==='restart_current_screen'&&invalidation.incarnation===marker.currentIncarnation&&frame.sequence>marker.cutoffSequence;
}
export function restartedProductInspection(state,frame,action){
  const marker=state.orderDemandStartup,invalidation=state.observationInvalidation;
  return !!marker?.currentIncarnation&&state.session.provider==='google_play_windows'&&['unknown','helicopter'].includes(state.scene.kind)&&
    state.scene.id==='restart:'+marker.currentIncarnation&&frame.sceneId===state.scene.id&&frame.epoch===state.scene.epoch&&
    state.latestFrameId===frame.id&&frame.sequence>marker.cutoffSequence&&invalidation?.reason==='restart_current_screen'&&
    invalidation.incarnation===marker.currentIncarnation&&action?.status==='superseded_on_restart'&&
    marker.completed?.[action.restartSupersession?.incarnation]?.actionIds?.includes(action.id)&&['issued','captured'].includes(action.restartSupersession?.previousStatus)&&
    Object.values(state.actions).at(-1)?.id===action.id&&action.inputAttempted===true&&action.target?.helicopterProductInfo?.mode==='open';
}
export function validateHelicopterInfoSource(state,frame,target,nextVisit,{evidence=null,pendingActionId=null}={}){
  validateHelicopterInfoProof(frame);
  if(frame.review?.reviewedBy!==HELICOPTER_INFO_READER||nextVisit.kind!=='helicopter'||!frame.review.targets.some(t=>same(t,target))||
    state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')throw Error('HELICOPTER_INFO_SOURCE_REQUIRED');
  if(target.helicopterProductInfo.mode==='dismiss')validateInspectionState(state,frame,{evidence,pendingActionId});
  if(frame.review.proof.role==='source'&&target.helicopterProductInfo.mode==='dismiss'){
    const restartOf=frame.review.data.helicopterProductInfo.restartOf;
    if(restartOf){
      const opened=state.actions[restartOf];
      if(opened?.status!=='superseded_on_restart'||
        !same({...opened.target.helicopterProductInfo,mode:'dismiss'},target.helicopterProductInfo))throw Error('HELICOPTER_INFO_RESTART_NOT_SAFE');
      return;
    }
    const data=frame.review.data.helicopterProductInfo,failed=state.actions[data.recoveryOf],source=state.frames[failed?.frameId],open=state.actions[source?.review?.data?.helicopterProductInfo?.actionId];
    const pending=pendingActionId&&state.actions[pendingActionId];
    if(pendingActionId&&(!pending||state.input!==pendingActionId||pending.status!=='pending'||pending.frameId!==frame.id||
      pending.epoch!==frame.epoch+1||state.scene.epoch!==pending.epoch||state.scene.id!==frame.sceneId||!same(pending.target,target)||!same(pending.nextVisit,nextVisit)))throw Error('HELICOPTER_INFO_RECOVERY_CONTEXT_CHANGED');
    // Admission increments the scene epoch once. Recheck the source visit only
    // after proving that this is the same still-pending recovery action.
    const sourceState=pending?{...state,scene:{...state.scene,epoch:frame.epoch}}:state;
    if(!failed||failed.status!=='rejected_before_input'||failed.inputAttempted!==false||!same(failed.target?.helicopterProductInfo,target.helicopterProductInfo)||
        source?.review?.data?.helicopterProductInfo?.recoveryOf||!acceptedFacts(source)||open?.status!=='verified'||open.target?.helicopterProductInfo?.mode!=='open'||
        !helicopterInfoRecoveryVisit(sourceState,frame,open)||open.target.helicopterProductInfo.evidenceKey!==target.helicopterProductInfo.evidenceKey||
        data.inspection.result.frameId!==source.id||data.inspection.actionId!==open.id)throw Error('HELICOPTER_INFO_RECOVERY_NOT_SAFE');
    const actions=Object.values(state.actions),after=actions.slice(actions.findIndex(a=>a.id===failed.id)+1).filter(a=>a.id!==pendingActionId);
    if(after.some(a=>a.inputAttempted||!same(a.target?.helicopterProductInfo,target.helicopterProductInfo)))throw Error('HELICOPTER_INFO_RECOVERY_CONTEXT_CHANGED');
    if(!data.nameEquivalence){
      const oldBox=source.review.data.helicopterProductInfo.popup?.nameBox;
      if(!same(oldBox,data.popup?.nameBox))throw Error('HELICOPTER_INFO_RECOVERY_POPUP_CHANGED');
      if(evidence){
        const before=evidence(source.id),current=evidence(frame.id);
        if(digest(before.bytes)!==source.evidenceHash||digest(current.bytes)!==frame.evidenceHash||
          !sameHelicopterInfoNameRegion(decodePng(before.bytes),decodePng(current.bytes),oldBox,data.popup.nameBox))throw Error('HELICOPTER_INFO_RECOVERY_POPUP_CHANGED');
      }
    }
    if(data.nameEquivalence){
      const tag=target.helicopterProductInfo,original=state.frames[tag.sourceFrameId],oldData=source.review.data.helicopterProductInfo;
      if(typeof evidence!=='function'||after.length||state.latestFrameId!==frame.id||(!pending&&state.input)||
        original?.evidenceHash!==tag.sourceHash||open.frameId!==original.id||open.resultFrameId!==source.id||
        oldData.mode!=='open'||oldData.confirmed!==true||oldData.frameId!==source.id||oldData.actionId!==open.id||
        !same({...open.target.helicopterProductInfo,mode:'dismiss'},tag)||oldData.sourceFrameId!==tag.sourceFrameId||
        oldData.sourceHash!==tag.sourceHash||oldData.evidenceKey!==tag.evidenceKey||oldData.slotId!==tag.slotId||frame.sequence<=source.sequence||
        [source,original].some(f=>f.provider!==frame.provider||f.serial!==frame.serial||!sameSelectionCaptureTarget(f.captureTarget,frame.captureTarget)))throw Error('HELICOPTER_INFO_NAME_EVIDENCE_REQUIRED');
      const read=f=>{
        const e=evidence(f.id);
        if(e?.frame?.id!==f.id||e.frame.evidenceHash!==f.evidenceHash||!e.bytes||digest(e.bytes)!==f.evidenceHash)throw Error('HELICOPTER_INFO_NAME_EVIDENCE_REQUIRED');
        const image=decodePng(e.bytes);
        if(image.width!==f.width||image.height!==f.height)throw Error('HELICOPTER_INFO_NAME_EVIDENCE_REQUIRED');
        return image;
      };
      read(original);
      const checked=helicopterInfoNameEquivalence(helicopterInfoRegistration(),{frame:source,image:read(source),box:oldData.popup.nameBox},
        {frame,image:read(frame),box:data.popup.nameBox},inputGeometry(state.session,frame).viewport);
      if(!checked||!same(checked,data.nameEquivalence))throw Error('HELICOPTER_INFO_NAME_EVIDENCE_CHANGED');
    }
  }
}
export function helicopterInfoResult(state,action,frame){
  if(!action.target?.helicopterProductInfo)return null;
  validateHelicopterInfoProof(frame);
  const d=frame.review?.data?.helicopterProductInfo;
  if(frame.review?.reviewedBy!==HELICOPTER_INFO_READER||d?.confirmed!==true||d.actionId!==action.id||d.frameId!==frame.id||
    d.mode!==action.target.helicopterProductInfo.mode||d.evidenceKey!==action.target.helicopterProductInfo.evidenceKey||
    d.sourceFrameId!==action.target.helicopterProductInfo.sourceFrameId||d.sourceHash!==action.target.helicopterProductInfo.sourceHash||
    d.slotId!==action.target.helicopterProductInfo.slotId||action.epoch!==frame.epoch||action.nextVisit.visitId!==frame.sceneId||
    !['issued','captured'].includes(action.status)||!action.inputAttempted)return null;
  if(d.mode==='open'&&!same(d.inspection,helicopterInspectionProof(state,action,frame,d.inspection?.source)))throw Error('HELICOPTER_INFO_CAUSAL_PROOF_CHANGED');
  return d;
}
export function verifyHelicopterInfoPreflight(frame,image,target,sourceImage){
  validateHelicopterInfoProof(frame);
  const data=frame.review?.data?.helicopterProductInfo,profile=helicopterProfile(frame).profile;
  // Tooltip borders, magnifier and time artwork animate. Bind dismissal to the
  // complete static name region plus the independently checked panel title.
  const boxes=target.helicopterProductInfo.mode==='dismiss'?[data.popup?.nameBox]:profile.slots.flatMap(s=>productIdentityRegions(profile,s.slotId));
  if(boxes.some(b=>!b))throw Error('HELICOPTER_INFO_PREFLIGHT_REQUIRED');
  if(target.helicopterProductInfo.mode==='dismiss'){
    if(!sameHelicopterInfoNameRegion(sourceImage,image,boxes[0]))throw Error('HELICOPTER_INFO_PREFLIGHT_CHANGED');
    return;
  }
  for(const box of boxes){
    if(digest(cropPng(image,box))!==digest(cropPng(sourceImage,box)))throw Error('HELICOPTER_INFO_PREFLIGHT_CHANGED');
  }
}

