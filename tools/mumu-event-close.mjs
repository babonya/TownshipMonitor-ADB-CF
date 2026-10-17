import {isUnresolvedAction} from './mumu-input-state.mjs';
// Event navigation uses OCR words, never leaderboard or animation pixels.
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash} from './mumu-evidence.mjs';
import {createCupOcrWorker} from './mumu-cup-ocr.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {targetIdentity,validWindowsNoInputProof,compareWindowsGeometry} from './windows-device.mjs';
import {resultCaptureDueAt} from './mumu-timing.mjs';
import {marketProfile,readMarketTown} from './mumu-market-proof.mjs';
export const EVENT_CLOSE_READER='program-event-close';
import {popupRegistry,popupRegistryHash,popupFields,popupTarget,matchPopupRule} from './mumu-popup-registry.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{throw Error('POPUP_OCR_PROOF_REQUIRED');};
export function eventTownReading(frame,image){
 const reg=marketProfile(),town=readMarketTown(image,reg);
 if(frame.provider!=='google_play_windows'||!town.supported)return null;
 return {supported:true,nextTown:{schema:1,profileHash:reg.hash,frameId:frame.id,
  evidenceHash:frame.evidenceHash,sequence:frame.sequence,epoch:frame.epoch,observedAt:frame.observedAt,town}};
}
const unresolved=a=>isUnresolvedAction(a);
export const eventCloseTarget=reading=>popupTarget(matchPopupRule(reading?.ocr));
export function validateEventCloseOcr(frame,image,reading){
 const o=reading?.ocr,rule=matchPopupRule(o);
 if(image.width!==popupRegistry.width||image.height!==popupRegistry.height||reading?.registryHash!==popupRegistryHash||reading.popupId!==rule?.id||!rule||
  o?.frameId!==(frame.id??frame.frameId)||o.evidenceHash!==frame.evidenceHash||o.sequence!==frame.sequence||o.epoch!==frame.epoch||o.observedAt!==frame.observedAt||
  o.scene!=='mayors_cup_result'||o.status!=='candidate'||o.provider!=='rapidocr'||o.executionAllowed!==false||o.ocrRequested!==true||o.fields?.length!==popupFields.length)fail();
 for(const [i,spec]of popupFields.entries()){const f=o.fields[i];if(f.fieldId!==spec.fieldId||f.kind!=='text'||!same(f.box,spec.box))fail();}
 return true;
}
export async function readEventClose(frame,bytes,image,{worker=null,python,offline=false}={}){
 const owned=!worker;worker??=createCupOcrWorker(python?{python}:{});
 try{const ocr=await worker.analyze({...frame,kind:'mayors_cup_result'},bytes,{scene:'mayors_cup_result',offline,fields:popupFields});
  const reading={ocr,registryHash:popupRegistryHash,popupId:matchPopupRule(ocr)?.id??null};
  try{validateEventCloseOcr(frame,image,reading);}catch(error){return {supported:false,reason:error.message,...reading};}
  return {supported:true,...reading};
 }finally{if(owned)worker.close();}
}
export function validateEventCloseReview(store,state,frame){
 if(frame.review.proof?.role!=='result')return validateEventCloseSource(store,state,frame);
 const r=frame.review,p=r.proof,a=state.actions[state.input];
 const image=store.evidence(frame.id).image;
 if(r.data.eventClose?.nextTown){if(!same(r.data.eventClose,eventTownReading(frame,image)))fail();}
 else validateEventCloseOcr(frame,image,r.data.eventClose);
 if(r.actualKind!=='unknown'||r.actualEntityId!==null||r.targets.length||!same(r.quality,{gameVisible:true,occluded:false})||
  p.schema!=='program-event-close-1'||p.frameId!==frame.id||p.evidenceHash!==frame.evidenceHash||p.reviewHash!==reviewFactHash(r)||
  p.inputId!==state.input||p.invalidationSequence!==(state.observationInvalidation?.sequence??null)||!a||!eventCloseResult(state,a,frame))fail();
}
export function validateEventCloseSource(store,state,frame,{pending=false}={}){
 const r=frame.review,p=r?.proof,a=state.actions[state.input],expected=eventCloseTarget(r?.data?.eventClose);
 validateEventCloseOcr(frame,store.evidence(frame.id).image,r?.data?.eventClose);
 if(r.reviewedBy!==EVENT_CLOSE_READER||r.actualKind!=='unknown'||r.actualEntityId!==null||
  !same(r.quality,{gameVisible:true,occluded:false})||!same(r.targets,[expected])||
  p?.schema!=='program-event-close-1'||p.frameId!==frame.id||p.evidenceHash!==frame.evidenceHash||p.reviewHash!==reviewFactHash(r)||
  p.inputId!==null||p.invalidationSequence!==(state.observationInvalidation?.sequence??null)||
  state.stopCapture||state.stopReader||state.latestFrameId!==frame.id||frame.sceneId!==state.scene.id||
  frame.epoch!==state.scene.epoch-(pending?1:0)||state.session.provider!=='google_play_windows'||frame.provider!==state.session.provider||
  frame.serial!==state.session.serial||frame.packageName!==state.session.packageName||
  !same(targetIdentity(frame.captureTarget),targetIdentity(state.session.windowsTarget))||!inputEvidenceValid(frame,store.clock(),state)||
  !Number.isFinite(Date.parse(frame.observedAt))||Date.parse(frame.observedAt)>store.clock()||store.clock()-Date.parse(frame.observedAt)>120000||
  Object.values(state.actions).some(x=>unresolved(x)&&(!pending||x!==a))||
  (pending?(a?.status!=='pending'||a.frameId!==frame.id||!same(a.target,expected)):!!state.input))fail();
 const attempts=Object.values(state.actions).filter(x=>x.id!==(pending?a.id:null)&&x.target?.eventClose&&state.frames[x.frameId]?.sceneId===frame.sceneId);
 if(attempts.length>=3||attempts.some(x=>x.status!=='rejected_before_input'||x.inputAttempted!==false||!same(x.target,expected)||
  !['USER_POINTER_ACTIVE','USER_INPUT_ACTIVE','INPUT_PREFLIGHT_EXPIRED'].includes(x.error)||
  !validWindowsNoInputProof(x.deviceRejectionProof,{actionId:x.id,command:x.command,bridgeHash:state.session.windowsBridgeHash,error:x.error})))throw Error('EVENT_CLOSE_ATTEMPT_LIMIT');
 const lock=join(store.root,'capture.lock');if(existsSync(lock)){const owner=JSON.parse(readFileSync(lock,'utf8'));if(owner.pid!==process.pid||!owner.token)throw Error('EVENT_CLOSE_OWNER_REQUIRED');}
 if(['helicopter-runner.lock','.management/runner.lock'].some(p=>existsSync(join(store.root,p)))||Object.values(state.transportMissions??{}).some(m=>m.waitingActionId))throw Error('EVENT_CLOSE_OWNER_REQUIRED');
 return true;
}
export async function observeEventClose(store,{frameId,actionId=null,python}={}){
 const state=store.load(),e=store.evidence(frameId);
 if(state.stopCapture||state.stopReader)throw Error('SESSION_STOPPED');
 if(state.input!==actionId||Object.values(state.actions).some(a=>unresolved(a)&&a.id!==actionId))throw Error('INPUT_UNRESOLVED');
 if(state.latestFrameId!==frameId||e.frame.epoch!==state.scene.epoch||!inputEvidenceValid(e.frame,store.clock(),state))throw Error('CURRENT_FRAME_REQUIRED');
 const reading=(actionId?eventTownReading(e.frame,e.image):null)??await readEventClose(e.frame,e.bytes,e.image,{python});if(!reading.supported)return {...reading,stored:false};
 const review={reviewedBy:EVENT_CLOSE_READER,quality:{gameVisible:true,occluded:false},actualKind:'unknown',actualEntityId:null,data:{eventClose:reading,...(actionId?{eventCloseResult:{actionId,frameId,event:state.actions[actionId]?.target?.eventClose?.event,dismissed:true}}:{})},targets:actionId?[]:[eventCloseTarget(reading)]};
 review.proof={schema:'program-event-close-1',frameId,evidenceHash:e.frame.evidenceHash,reviewHash:reviewFactHash(review),inputId:actionId,role:actionId?'result':'source',invalidationSequence:state.observationInvalidation?.sequence??null};
 if(actionId&&!eventCloseResult(state,state.actions[actionId],{...e.frame,review}))return {stored:false,reason:'POPUP_RESULT_NOT_CONFIRMED'};
 await store.retry(()=>store.pinFrame(frameId,{ocr:false}));
 await store.retry(()=>store.review({frameId,...review,programToken:PROGRAM_REVIEW_TOKEN}));
 return {stored:true,targets:review.targets,review};
}
// A new/unsupported next screen needs an explicit result observation. Title
// absence alone is not proof of dismissal; it could be a failed OCR read.
export function eventCloseResult(state,action,frame){
 if(!action)return null;
 const r=frame.review,result=r?.data?.eventCloseResult,source=state.frames[action.frameId],receipt=action.deviceReceipt,due=resultCaptureDueAt(action);
 try{compareWindowsGeometry(source,frame);}catch{return null;}
 const town=r?.data?.eventClose?.nextTown;
 const registeredTown=town?.schema===1&&town.profileHash===marketProfile().hash&&town.frameId===frame.id&&town.evidenceHash===frame.evidenceHash&&town.sequence===frame.sequence&&town.epoch===frame.epoch&&town.observedAt===frame.observedAt&&town.town?.supported===true;
 const programResult=r?.reviewedBy===EVENT_CLOSE_READER&&r.proof?.role==='result'&&r.proof.reviewHash===reviewFactHash(r)&&(registeredTown||r.data.eventClose.registryHash===popupRegistryHash&&matchPopupRule(r.data.eventClose.ocr)?.id!==action.target?.eventClose?.event&&!!matchPopupRule(r.data.eventClose.ocr));
 if((r?.reviewedBy!=='GPT'&&!programResult)||result?.actionId!==action.id||result.frameId!==frame.id||result.dismissed!==true||
  result.event!==action.target?.eventClose?.event||!same(action.target,eventCloseTarget(source?.review?.data?.eventClose))||source?.review?.reviewedBy!==EVENT_CLOSE_READER||
  action.eventCloseSourceHash!==reviewFactHash(source.review)||!same(action.command,{type:'tap',x:Math.floor(action.target.box.x+action.target.box.width/2),y:Math.floor(action.target.box.y+action.target.box.height/2)})||receipt?.actionId!==action.id||
  receipt.status!=='issued'||receipt.attempted!==3||receipt.inserted!==3||receipt.error!==null||receipt.commandIssued!==true||
  due===null||!Number.isFinite(Date.parse(frame.captureStartedAt))||Date.parse(frame.captureStartedAt)<due||
  state.input!==action.id||!['issued','captured'].includes(action.status)||state.latestFrameId!==frame.id||
  frame.epoch!==action.epoch||frame.sceneId!==action.nextVisit.visitId||frame.sequence<=source.sequence||frame.evidenceHash===source.evidenceHash||
  !same(targetIdentity(frame.captureTarget),targetIdentity(source.captureTarget)))return null;
 return {schema:1,actionId:action.id,frameId:frame.id,event:action.target.eventClose.event,dismissed:true};
}
