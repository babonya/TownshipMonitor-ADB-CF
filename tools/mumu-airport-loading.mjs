import {generatedActionId} from './mumu-action-id.mjs';
import {transportAbbreviation} from './mumu-transport-id.mjs';
// Native airport facts and evidenced one-crate transitions. No dispatch authority.
import {digest} from './adb.mjs';
import {PROGRAM_REVIEW_TOKEN,acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
import {RapidOcrWorker,frameMetadata} from './mumu-perception-bridge.mjs';
import {airportLoadingProfile,readAirportLoading,airportLoadingTargets,validateAirportLoadingProof,airportAllocationAllowsCrate} from './mumu-airport-loading-proof.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
import {orderSignature,orderDisposition} from './mumu-order-policy.mjs';
import {inspectDeliveryIdentities,deliveryIdentityEvidence} from './mumu-product-recognition.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sha=x=>digest(Buffer.from(JSON.stringify(x??null))),fail=code=>{throw Error(code);};
const plain=needs=>needs.map(({slotId,itemId,required})=>({slotId,itemId,required}));
function fieldValue(frame,reading,ocr,registration){
 if(!reading.field){if(ocr!==null)fail('AIRPORT_OCR_UNEXPECTED');return null;}
 const meta=frameMetadata(frame),field=reading.field,f=ocr?.fields?.[0];
 if(!ocr||!['frameId','epoch','sequence','observedAt','evidenceHash'].every(k=>ocr[k]===meta[k])||ocr.scene!=='airport'||ocr.fields.length!==1||
  !f||f.fieldId!==field.fieldId||f.kind!==field.kind||!same(f.box,field.box)||f.scale!==field.scale||f.recognitionOnly!==true||
  f.status!=='parsed_candidate'||!f.ocrScores?.length||f.ocrScores.some(s=>!Number.isFinite(s)||s<field.minimumScore||s>1))fail('AIRPORT_EXACT_FIELD_REQUIRED');
 if(field.kind!=='stock_pair')fail('AIRPORT_STOCK_FIELD_REQUIRED');
 const m=/^\s*(\d{1,6})\s*\/\s*(\d{1,6})\s*$/.exec(f.rawText??''),need=registration.profile.originalNeeds.find(n=>n.slotId===reading.selectedCrate);
 if(!m||f.itemId!==field.itemId||f.slotId!==field.slotId||Number(m[1])!==f.value?.owned||Number(m[2])!==need.required||f.value.required!==need.required||
  !Number.isSafeInteger(f.value.owned)||f.value.owned<0)fail('AIRPORT_EXACT_STOCK_PAIR_REQUIRED');return f.value;
}
function context(state,frame,reading,now){
 if(state.input){
  const a=state.actions[state.input],before=state.frames[a?.frameId];
  if(!['issued','captured'].includes(a?.status)||a.inputAttempted!==true||!acceptedFacts(before)||before.review.reviewedBy!=='program-airport-loading'||
   !['load_airport','inspect_item'].includes(a.target.kind)||a.target.kind==='inspect_item'&&!a.target.airportDetail||
   before.review.data.airport.fullDemandConfirmed!==true||frame.epoch!==a.epoch||frame.sequence<=before.sequence||frame.evidenceHash===before.evidenceHash||
   !Number.isFinite(Date.parse(a.issuedAt))||!Number.isFinite(Date.parse(frame.captureStartedAt))||Date.parse(frame.captureStartedAt)<Date.parse(a.issuedAt)+1000||
   (state.observationInvalidation?.sequence??-1)>=before.sequence||!inputEvidenceValid(before,now,state))fail('AIRPORT_OWNED_RESULT_REQUIRED');
  validateAirportLoadingProof(before);return before;
 }
 const prior=Object.values(state.frames??{}).filter(f=>orderDemandCurrent(state,f)&&f.id!==frame.id&&f.sequence<frame.sequence&&f.epoch===frame.epoch&&f.sceneId===frame.sceneId&&acceptedFacts(f)&&
  f.review.reviewedBy==='program-airport-loading'&&f.review.data.airport.timingMode==='visual_change'&&f.review.data.airport.fullDemandConfirmed&&inputEvidenceValid(f,now,state)).sort((a,b)=>b.sequence-a.sequence)[0];
 if(prior)validateAirportLoadingProof(prior);return prior??null;
}
export function decodeAirportLoading(state,frame,reading,ocr,{now=Date.now(),registration=airportLoadingProfile(frame)}={}){
 if(!reading.supported)fail(reading.reason);
 const value=fieldValue(frame,reading,ocr,registration),source=context(state,frame,reading,now),old=source?.review.data,a=state.actions?.[state.input],profile=registration.profile;
 const selected=profile.originalNeeds.find(n=>n.slotId===reading.selectedCrate),current=profile.originalNeeds.filter(n=>!reading.loadedSlots.includes(n.slotId));
 let full=!!old||reading.stage===0&&!reading.selectedCrate,origin=old?.airport.origin??(full?{frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,observedAt:frame.observedAt}:null);
 let orderId=old?.order.orderId??transportAbbreviation('plane')+':'+sha({origin,layout:reading.layoutId}).slice(0,40);
 if(old){
  if(old.airport.layoutId!==reading.layoutId)fail('AIRPORT_LAYOUT_CHANGED');
  if(!a||a.target.kind==='inspect_item'){
   if(!same(old.airport.loadedSlots,reading.loadedSlots)||!same(plain(old.order.needs),current))fail('AIRPORT_UNTRACKED_CRATE_CHANGE');
   if(a&&(a.target.airportDetail.caseId!==reading.caseId||a.target.airportDetail.orderId!==orderId||a.target.airportDetail.layoutId!==reading.layoutId))fail('AIRPORT_DETAIL_RESULT_REQUIRED');
  }else{
   const t=profile.loadTransitions.find(t=>t.popupId===old.airport.caseId),n=old.order.needs.find(n=>n.slotId===old.airport.selectedCrate),m=a.target.management;
   if(!t||reading.selectedCrate||reading.stage!==t.resultStage||m?.programVerified!==true||m.currency!=='NONE'||m.orderId!==orderId||
    m.layoutId!==reading.layoutId||m.slotId!==n?.slotId||m.itemId!==n.itemId||m.required!==n.required||m.owned!==n.owned||!Number.isSafeInteger(m.owned)||m.owned<m.required||
    !same([...old.airport.loadedSlots,n.slotId].sort(),[...reading.loadedSlots].sort())||!same(current,plain(old.order.needs.filter(x=>x.slotId!==n.slotId))))fail('AIRPORT_SAME_CRATE_RESULT_REQUIRED');
  }
 }
 const needs=(!full&&selected?[selected]:current).map(n=>({...n,owned:selected&&n.itemId===selected.itemId?value.owned:null}));
 const data={order:{orderId,kind:'normal',transport:'plane',identityMode:'product_list',orderConfirmed:full,signature:full?orderSignature(profile.originalNeeds):null,
  needs,disposition:full?orderDisposition(profile.originalNeeds):'hold'},
  airport:{timingMode:'visual_change',layoutId:reading.layoutId,caseId:reading.caseId,stage:reading.stage,selectedCrate:reading.selectedCrate,loadedSlots:reading.loadedSlots,
   originalNeeds:full?profile.originalNeeds:null,origin,fullDemandConfirmed:full,freeLoad:reading.freeLoad}};
 if(a?.target.kind==='load_airport'){
  const n=old.order.needs.find(n=>n.slotId===old.airport.selectedCrate);
  data.actionResult={actionId:a.id,frameId:frame.id,confirmed:true,effect:'The same airport crate is loaded; exactly its demand is removed.',orderId,
   inventoryInvalidated:[n.itemId],airportLoadReceipt:{slotId:n.slotId,itemId:n.itemId,required:n.required,loaded:true,remainingDemandConfirmed:true,stockAfterNotObserved:true}};
 }else if(a)data.airportDetailResult={actionId:a.id,frameId:frame.id,confirmed:true,caseId:reading.caseId,orderId,inventoryUnchanged:true};
 const review={reviewedBy:'program-airport-loading',actualKind:'airport',actualEntityId:null,quality:{gameVisible:true,occluded:false},data,targets:airportLoadingTargets(reading,data,registration)};
 return {review,contextFrameId:source?.id??null};
}
export async function observeAirportLoading(store,{frameId='latest',offline=false}={},workers={}){
 const state=store.load(),fid=frameId==='latest'?state.latestFrameId:frameId;
 if(!offline&&(state.stopCapture||state.stopReader))fail('SESSION_STOPPED');
 if(!offline&&(fid!==state.latestFrameId||state.frames[fid]?.epoch!==state.scene.epoch))fail('CURRENT_FRAME_REQUIRED');
 const evidence=store.evidence(fid),registration=airportLoadingProfile(evidence.frame),reading=readAirportLoading(evidence.image,registration);
 if(!reading.supported)return {...reading,stored:false,frameId:fid};
 if(!offline&&(state.observationInvalidation?.sequence??-1)>=evidence.frame.sequence)fail('OBSERVATION_CONTEXT_CHANGED');
 const prior=evidence.frame.review;
 if(!offline&&!state.input&&prior?.reviewedBy==='program-airport-loading'){validateAirportLoadingProof(evidence.frame);return {...reading,frameId:fid,stored:true,review:prior,reused:true};}
 const worker=reading.field?(workers.ocr??new RapidOcrWorker()):null;
 try{
  const ocr=worker?await worker.analyze(evidence.frame,evidence.bytes,{offline:true,scene:'airport',fields:[reading.field]}):null;
  const decoded=decodeAirportLoading(offline?{...state,input:null,actions:{},frames:{}}:state,evidence.frame,reading,ocr,{registration,now:store.clock()}),review=decoded.review;
  const open=registration.profile.originalNeeds.filter(n=>!reading.loadedSlots.includes(n.slotId));
  const regions=open.map(n=>{const index=registration.profile.originalNeeds.findIndex(s=>s.slotId===n.slotId),b=registration.profile.grid[index];
   return {slotId:n.slotId,nativeItemId:n.itemId,box:{x:b.x+Math.round(b.width*29/153),y:b.y+Math.round(b.height*49/132),width:Math.round(b.width*70/153),height:Math.round(b.height*42/132)}};
  });
  const identity=await inspectDeliveryIdentities(evidence,regions,workers.matcher),productRecognition=deliveryIdentityEvidence(reading,identity,open);
  if(productRecognition)review.data.airport.productRecognition=productRecognition;
  review.proof={schema:'program-airport-loading-1',frameId:fid,evidenceHash:evidence.frame.evidenceHash,profileHash:registration.hash,inputId:offline?null:state.input,
   ...(productRecognition?{productRecognition:{catalogueManifestSha256:productRecognition.catalogueManifestSha256,thresholdSha256:productRecognition.thresholdSha256}}:{}),
   invalidationSequence:state.observationInvalidation?.sequence??null,contextFrameId:decoded.contextFrameId,fieldsHash:sha(ocr?.fields??[]),reviewHash:reviewFactHash(review)};
  if(!offline){const current=store.load();if(current.latestFrameId!==fid||current.input!==state.input||current.stopCapture||current.stopReader||current.scene.epoch!==evidence.frame.epoch||
    sha(current.session.management)!==sha(state.session.management)||sha(current.frames[fid]?.review)!==sha(prior)||sha(current.frames[decoded.contextFrameId]?.review)!==sha(state.frames[decoded.contextFrameId]?.review)||
    (current.observationInvalidation?.sequence??null)!==(state.observationInvalidation?.sequence??null))fail('OBSERVATION_CONTEXT_CHANGED');
   await store.retry(()=>store.pinFrame(fid,{ocr:false}));await store.retry(()=>store.review({frameId:fid,...review,programToken:PROGRAM_REVIEW_TOKEN}));}
  return {...reading,stored:!offline,frameId:fid,review,ocr};
 }finally{if(worker&&!workers.ocr)worker.close();}
}
export function airportLoadingPlan(state,reading){
 const t=reading.review.targets.find(t=>t.kind==='load_airport');if(!t)return null;const id=generatedActionId(state,{frameId:reading.frameId,targetId:t.id,kind:'l'},()=> 'airport-load:'+sha({session:state.session.id,frame:reading.frameId,target:t.id}).slice(0,32)),m=t.management;
 return {source:'explicit_user',missionId:id,sessionId:state.session.id,maxCoins:0,steps:[{actionId:id,kind:'load_airport',frameId:reading.frameId,targetId:t.id,orderId:m.orderId,itemId:m.itemId,maxUnits:m.required,nextVisit:{visitId:id+'-result',kind:'airport',required:true}}]};
}
export function selectAirportDetail(reading,allocation,registration=airportLoadingProfile()){
 const data=reading.review.data;if(!data.airport.fullDemandConfirmed||data.order.disposition!=='deliver')return null;
 const items=allocation.projection?.items??{},order=allocation.evaluations?.find(o=>o.orderId===data.order.orderId);
 const feasible=p=>{
  if(!p)return false;
  const n=data.order.needs.find(n=>n.slotId===p.slotId),stock=items[p.itemId];if(!n||stock?.fresh!==true)return false;
  const reserve=(allocation.projection.reservations??[]).filter(r=>r.orderId===data.order.orderId&&r.itemId===p.itemId).reduce((v,r)=>v+r.quantity,0);
  return airportAllocationAllowsCrate(order)&&stock.quantity>=n.required&&reserve>=n.required&&registration.profile.loadTransitions.some(t=>t.popupId===p.id);
 };
 const missing=p=>!!p&&data.order.needs.some(n=>n.slotId===p.slotId)&&items[p.itemId]?.fresh!==true;
 if(reading.selectedCrate){
  const other=registration.profile.popups.some(p=>p.stage===reading.stage&&p.slotId!==reading.selectedCrate&&(feasible(p)||missing(p)));
  return other?reading.review.targets.find(t=>t.airportDetail?.slotId===null)??null:null;
 }
 const targets=reading.review.targets.filter(t=>t.airportDetail),popup=t=>registration.profile.popups.find(p=>p.id===t.airportDetail.caseId);
 return targets.find(t=>feasible(popup(t)))??targets.find(t=>missing(popup(t)))??null;
}
// A confirmed shortage is exhausted only when every remaining product is known
// and neither a supported reserved load nor useful detail can progress it.
export function airportExhaustedShortage(reading,allocation,registration=airportLoadingProfile()){
 const data=reading.review?.data,order=allocation?.evaluations?.find(o=>o.orderId===data?.order?.orderId);
 if(data?.airport?.fullDemandConfirmed!==true||data.order.disposition!=='deliver'||!data.order.needs.length||
  order?.status!=='shortage'||!data.order.needs.every(n=>allocation.projection?.items?.[n.itemId]?.fresh===true)||
  selectAirportDetail(reading,allocation,registration))return false;
 const target=reading.review.targets.find(t=>t.kind==='load_airport'),m=target?.management;
 const reserved=m?(allocation.projection.reservations??[]).filter(r=>r.orderId===data.order.orderId&&r.itemId===m.itemId).reduce((v,r)=>v+r.quantity,0):0;
 if(m&&allocation.projection.items[m.itemId].quantity!==m.owned)return false;
 return !m||!airportAllocationAllowsCrate(order)||reserved<m.required;
}
