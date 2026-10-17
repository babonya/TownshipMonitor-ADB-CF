import {generatedActionId} from './mumu-action-id.mjs';
import {transportAbbreviation} from './mumu-transport-id.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
// Native ordinary train facts, exact evidenced load results and one-step recipes.
// This module grants no authority and never recovers unknown input or sends trains.
import {digest} from './adb.mjs';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash,acceptedFacts} from './mumu-evidence.mjs';
import {readTrainLoading,trainLoadingProfile,trainLoadingTargets,validateTrainLoadingProof,trainLoadContextMatches,trainLoadResultPopupMatches,trainRowMatches,trainLoadingRow,trainAllocationAllowsCarriage} from './mumu-train-loading-proof.mjs';
import {RapidOcrWorker} from './mumu-perception-bridge.mjs';
import {orderSignature,orderDisposition} from './mumu-order-policy.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
import {validateTrainRewardProof} from './mumu-train-reward-proof.mjs';
import {transportNavigationProfile,validateTransportNavigationProof} from './mumu-transport-navigation-proof.mjs';
import {independentTrain,decodeTrainSlots} from './mumu-train-slots.mjs';
import {inspectDeliveryIdentities,deliveryIdentityEvidence} from './mumu-product-recognition.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=x=>digest(Buffer.from(JSON.stringify(x??null)));
const demands=slots=>slots.filter(s=>!s.loaded).map(({slotId,itemId,required})=>({slotId,itemId,required}));
const loadedIds=slots=>slots.filter(s=>s.loaded).map(s=>s.slotId).sort();
const fail=code=>{throw Error(code);};
// A cross-visit partial row never invents the goods in checked carriages. Reuse
// its confirmed original only through an unbroken, nonconsumptive route ledger.
function reentryContext(state,frame,reading,now){
 if(frame.provider!=='google_play_windows'||reading.barePartial!==true||state.input||
  hasUnresolvedActions(state.actions??{}))return null;
 const prior=Object.values(state.frames??{}).filter(f=>orderDemandCurrent(state,f)&&f.sequence<frame.sequence&&f.review?.reviewedBy==='program-train-loading'&&
  trainRowMatches(f.review.data.train,reading)).sort((a,b)=>b.sequence-a.sequence)[0];
 if(!prior||prior.provider!==frame.provider||prior.serial!==frame.serial||!acceptedFacts(prior)||
  prior.review.data.train.fullDemandConfirmed!==true||!inputEvidenceValid(prior,now,state))return null;
 validateTrainLoadingProof(prior,trainLoadingProfile(prior,prior.review.proof.profileHash));
 if(!same(demands(reading.slots),prior.review.data.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})))||
  !same(loadedIds(reading.slots),prior.review.data.train.loadedCarriages.map(s=>s.slotId).sort()))return null;
 const actions=Object.values(state.actions??{}).filter(a=>state.frames[a.frameId]?.sequence>=prior.sequence||Date.parse(a.at)>Date.parse(prior.observedAt))
  .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 let kind='train',sequence=prior.sequence,epoch=prior.epoch,last=null,count=0;
 for(const a of actions){
  const source=state.frames[a.frameId],route=a.target?.transportNavigation;
  if(!source||source.provider!==frame.provider||source.serial!==frame.serial||source.sequence<sequence||source.epoch<epoch||
   !Number.isFinite(Date.parse(a.at))||Date.parse(a.at)<Date.parse(source.observedAt)||a.management!==false||!route||route.from!==kind||
   !['close_panel','open_train','open_airport','open_helicopter'].includes(a.target.kind)||a.target.type!=='tap'||
   a.command?.type!=='tap'||a.command.x!==Math.floor(a.target.box.x+a.target.box.width/2)||a.command.y!==Math.floor(a.target.box.y+a.target.box.height/2)||
   source.review?.reviewedBy!=='program-transport-navigation'||source.review.proof.role!=='source'||
   !source.review.targets.some(t=>same(t,a.target))||!inputEvidenceValid(source,now,state))return null;
  validateTransportNavigationProof(source,transportNavigationProfile(source,source.review.proof.profileHash));
  if(a.status==='rejected_before_input'){
   if(a.inputAttempted!==false||a.issuedAt||a.inputReservedAt||a.deviceReceipt||a.resultFrameId||a.resultProof)return null;
   continue;
  }
  const result=state.frames[a.resultFrameId],proof=a.resultProof,nav=proof?.navigation,receipt=a.deviceReceipt;
  if(a.status!=='verified'||a.inputAttempted!==true||!result||result.provider!==frame.provider||result.serial!==frame.serial||
   receipt?.actionId!==a.id||receipt.status!=='issued'||receipt.commandIssued!==true||receipt.gameResultVerified!==false||
   !Number.isSafeInteger(receipt.inserted)||receipt.inserted<=0||receipt.inserted!==receipt.attempted||
   result.sequence<=source.sequence||result.epoch!==a.epoch||result.sceneId!==a.nextVisit?.visitId||a.nextVisit.kind!==route.to||
   !Number.isFinite(Date.parse(a.issuedAt))||!Number.isFinite(Date.parse(result.captureStartedAt))||Date.parse(result.captureStartedAt)<Date.parse(a.issuedAt)+1000||
   !proof||proof.frameId!==result.id||proof.evidenceHash!==result.evidenceHash||proof.sequence!==result.sequence||proof.observedAt!==result.observedAt||
   !same(nav,{actionId:a.id,frameId:result.id,confirmed:true,from:route.from,to:route.to})||
   proof.review?.reviewedBy!=='program-transport-navigation'||proof.review.actualKind!==route.to||
   proof.review?.proof?.inputId!==a.id||proof.review.proof.role!=='result'||!same(proof.review.proof.navigationResult,nav))return null;
  validateTransportNavigationProof({...result,review:proof.review},transportNavigationProfile(result,proof.review.proof.profileHash));
  if(count===0&&(route.from!=='train'||route.to!=='town'||source.epoch!==prior.epoch))return null;
  kind=route.to;sequence=result.sequence;epoch=result.epoch;last=result;count++;
 }
 return count>=2&&kind==='train'&&last.epoch===frame.epoch&&last.sceneId===frame.sceneId&&last.sequence<=frame.sequence?prior:null;
}
function sourceContext(state,frame,reading,now){
 const action=state.actions?.[state.input],source=state.frames[action?.frameId];
 if(state.input){
  const detail=action?.target?.kind==='inspect_item'&&action.target.trainDetail;
  if(!['issued','captured'].includes(action?.status)||(!detail&&(action.target?.kind!=='load_train'||action.target.management?.programVerified!==true))||
   source?.review?.reviewedBy!=='program-train-loading'||!acceptedFacts(source)||frame.epoch!==action.epoch||frame.sequence<=source.sequence||
   (state.observationInvalidation?.sequence??-1)>=source.sequence)fail('TRAIN_OWNED_RESULT_REQUIRED');
  // Issued native navigation keeps its immutable source profile when a newly
  // evidenced result is registered. The current profile still decodes results.
  validateTrainLoadingProof(source,trainLoadingProfile(source,source.provider==='google_play_windows'?source.review.proof.profileHash:null));return source;
 }
 const prior=Object.values(state.frames??{}).filter(f=>orderDemandCurrent(state,f)&&f.id!==frame.id&&f.sequence<frame.sequence&&f.epoch===frame.epoch&&f.sceneId===frame.sceneId&&
  f.review?.reviewedBy==='program-train-loading'&&acceptedFacts(f)&&f.review.data.train.fullDemandConfirmed===true&&trainRowMatches(f.review.data.train,reading)&&inputEvidenceValid(f,now,state))
  .sort((a,b)=>b.sequence-a.sequence)[0];
 if(prior){validateTrainLoadingProof(prior,trainLoadingProfile(prior,prior.provider==='google_play_windows'?prior.review.proof.profileHash:null));return prior;}
 return reentryContext(state,frame,reading,now);
}
export function decodeTrainLoading(state,frame,reading,ocr,{registration=trainLoadingProfile(frame),now=Date.now(),temporaryContext=null}={}){
 if(!reading.supported)fail(reading.reason);
 if(independentTrain(registration))return decodeTrainSlots(state,frame,reading,ocr,{registration,now,temporaryContext,
  validateSource:source=>validateTrainLoadingProof(source,trainLoadingProfile(source,source.review.proof.profileHash))});
 const selected=reading.slots.find(s=>s.slotId===reading.selectedCarriage);
 let value=null;
 if(reading.field){
 if(!ocr||ocr.frameId!==frame.id||ocr.evidenceHash!==frame.evidenceHash||ocr.sequence!==frame.sequence||ocr.epoch!==frame.epoch||
  ocr.observedAt!==frame.observedAt||ocr.scene!=='train'||ocr.fields?.length!==1)fail('TRAIN_OCR_FRAME_BINDING_REQUIRED');
 const f=ocr.fields[0],field=reading.field;value=f.value;
 if(f.status!=='parsed_candidate'||f.fieldId!==field.fieldId||f.kind!=='stock_pair'||f.itemId!==field.itemId||f.slotId!==field.slotId||
  !same(f.box,field.box)||f.scale!==field.scale||f.recognitionOnly!==true||!Array.isArray(f.ocrScores)||!f.ocrScores.length||
  f.ocrScores.some(s=>!Number.isFinite(s)||s<field.minimumScore)||!/^\s*\d{1,6}\s*\/\s*\d{1,6}\s*$/.test(f.rawText??'')||
  !Number.isSafeInteger(value?.owned)||value.owned<0||value.required!==selected.required||
  Number(f.rawText.split('/')[0].trim())!==value.owned||Number(f.rawText.split('/')[1].trim())!==value.required)fail('TRAIN_EXACT_STOCK_PAIR_REQUIRED');
 }else if(ocr!==null||reading.selectedCarriage!==null||reading.popupId!==null||reading.freeLoad||(!reading.departed&&reading.slots.some(s=>s.loaded)&&
  !(registration.profile.provider==='google_play_windows'&&reading.barePartial===true&&
   (trainLoadingRow(registration.profile,reading)?.barePartialProof==='tracked_slot_states'||
    (trainLoadingRow(registration.profile,reading)?.bareLoadedStates??[]).some(ids=>same([...ids].sort(),loadedIds(reading.slots)))))))fail('TRAIN_BARE_ROW_REQUIRED');
 const context=sourceContext(state,frame,reading,now);let previous=context?.review.data;
 const current=demands(reading.slots),loaded=loadedIds(reading.slots),action=state.actions?.[state.input];
 const entryId=action?.target?.trainDetail?.rowEntryId;
 if(entryId){
  const entry=(registration.profile.rowEntries??[]).find(e=>e.id===entryId),d=action.target.trainDetail;
  const fromPopup=registration.profile.popups.find(p=>p.id===entry?.from.popupId);
  if(action.target.kind!=='inspect_item'||!entry||!previous||!trainRowMatches(entry.from,previous.train)||!trainRowMatches(entry.to,reading)||
   previous.train.selectedCarriage!==fromPopup?.slotId||
   !trainRowMatches(d,reading)||d.orderId!==previous.order.orderId||d.slotId!==entry.to.slotId||d.itemId!==entry.to.itemId||d.popupId!==entry.to.popupId||
   reading.selectedCarriage!==entry.to.slotId||reading.popupId!==entry.to.popupId||
   selected?.itemId!==entry.to.itemId||loaded.length||!trainLoadContextMatches(entry,previous.train.loadedCarriages))fail('TRAIN_ROW_ENTRY_RESULT_REQUIRED');
  // First entry observes a complete unfilled row. It establishes that row's own
  // demand/order identity; the source row and its reservations remain separate.
  previous=null;
 }
 if(reading.departed&&(!previous||!state.input||action?.target.kind!=='load_train'))fail('TRAIN_DEPARTURE_CONTEXT_REQUIRED');
 let originalNeeds,orderId,origin,fullDemandConfirmed=true;
 if(previous){
  if(!trainRowMatches(previous.train,reading))fail('TRAIN_ROW_CHANGED');
  originalNeeds=previous.train.originalNeeds;orderId=previous.order.orderId;origin=previous.train.origin;
  if(!Array.isArray(originalNeeds)||!originalNeeds.length||!orderSignature(originalNeeds))fail('TRAIN_ORIGINAL_DEMAND_REQUIRED');
  if((!state.input||action?.target.kind==='inspect_item')&&(!same(current,previous.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})))||
   !same(loaded,previous.train.loadedCarriages.map(s=>s.slotId).sort())))fail('TRAIN_UNTRACKED_ROW_CHANGE');
  if(state.input&&action.target.kind==='inspect_item'){
   const d=action.target.trainDetail;
   if(!d||!trainRowMatches(d,reading)||d.slotId!==reading.selectedCarriage||d.popupId!==reading.popupId||d.itemId!==selected.itemId||
    d.orderId!==previous.order.orderId||reading.selectedCarriage===previous.train.selectedCarriage)fail('TRAIN_DETAIL_RESULT_REQUIRED');
  }
  if(state.input&&action.target.kind==='load_train'){
   const chosen=previous.order.needs.find(n=>n.slotId===previous.train.selectedCarriage),m=action.target.management;
   const transition=registration.profile.loadTransitions.find(t=>trainRowMatches(t,reading)&&t.slotId===chosen?.slotId&&t.itemId===chosen?.itemId);
   if(reading.departed&&(transition?.automaticDeparture!==true||previous.order.needs.length!==1||current.length||
    previous.train.loadedCarriages.length!==originalNeeds.length-1))fail('TRAIN_LAST_LOAD_REQUIRED');
   if(!transition||!trainLoadContextMatches(transition,previous.train.loadedCarriages)||!trainLoadResultPopupMatches(transition,reading,registration)||!trainRowMatches(m,reading)||m.slotId!==chosen.slotId||m.itemId!==chosen.itemId||m.required!==chosen.required||
    m.owned!==chosen.owned||!Number.isSafeInteger(m.owned)||m.owned<m.required||m.currency!=='NONE'||m.orderId!==previous.order.orderId||
    !same(current,previous.order.needs.filter(n=>n.slotId!==chosen.slotId).map(({slotId,itemId,required})=>({slotId,itemId,required})))||
    !same(loaded,[...previous.train.loadedCarriages.map(s=>s.slotId),chosen.slotId].sort()))fail('TRAIN_SAME_CARRIAGE_RESULT_REQUIRED');
  }
 }else{
  if(loaded.length){
   // The selected absolute stock is still useful. Missing original demand
   // cannot create an allocatable order, targets or a load-result receipt.
   fullDemandConfirmed=false;originalNeeds=null;origin=null;
   orderId=transportAbbreviation('train')+'-unbound:r'+reading.row+':'+sha(current).slice(0,32);
  }else{
   originalNeeds=current;origin={frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,observedAt:frame.observedAt};
   orderId=transportAbbreviation('train')+':r'+reading.row+':'+orderSignature(originalNeeds)+':'+sha(origin).slice(0,16);
  }
 }
 if(fullDemandConfirmed&&(current.length+loaded.length!==originalNeeds.length||current.some(n=>!originalNeeds.some(o=>same(o,n)))||
  loaded.some(slot=>!originalNeeds.some(n=>n.slotId===slot))))fail('TRAIN_ORIGINAL_DEMAND_CHANGED');
 const needs=current.map(n=>({...n,owned:selected&&n.itemId===selected.itemId?value.owned:null}));
 const data={order:{orderId,kind:'normal',transport:'train',identityMode:'product_list',signature:fullDemandConfirmed?orderSignature(originalNeeds):null,
  orderConfirmed:fullDemandConfirmed,needs,...reading.departed?{completed:true}:{},disposition:fullDemandConfirmed?orderDisposition(originalNeeds):'hold'},train:{row:reading.row,...reading.layoutId?{layoutId:reading.layoutId}:{},selectedCarriage:reading.selectedCarriage,
  fullDemandConfirmed,originalNeeds,origin,loadedCarriages:loaded.map(slotId=>fullDemandConfirmed?({...originalNeeds.find(n=>n.slotId===slotId),loaded:true}):({slotId,loaded:true,itemId:null,required:null})),
  profileVersion:registration.profile.version}};
 if(reading.departed)data.departure={row:reading.row,automatic:true,departed:true,completedByLoad:true};
 const targets=state.session.management?trainLoadingTargets(reading,data,registration):[];
 return {review:{reviewedBy:'program-train-loading',quality:{gameVisible:true,occluded:false},actualKind:'train',actualEntityId:null,data,targets},contextFrameId:context?.id??null};
}
export function trainLoadResult(state,action,frame,data){
 const before=state.frames[action?.frameId],m=action?.target?.management;
 if(action?.target?.kind!=='load_train'||action.management!==true||action.inputAttempted!==true||!['issued','captured'].includes(action.status)||
  !acceptedFacts(before)||before.review.reviewedBy!=='program-train-loading'||frame.epoch!==action.epoch||frame.sequence<=before.sequence||
  frame.evidenceHash===before.evidenceHash||(state.observationInvalidation?.sequence??-1)>=before.sequence||
  !Number.isFinite(Date.parse(action.issuedAt))||!Number.isFinite(Date.parse(frame.captureStartedAt))||Date.parse(frame.captureStartedAt)<Date.parse(action.issuedAt)+1000)return null;
 const old=before.review.data,slot=old.order.needs.find(n=>n.slotId===old.train.selectedCarriage);
 if(m?.programVerified!==true||slot?.slotId!==m.slotId||slot.itemId!==m.itemId||slot.required!==m.required||slot.owned!==m.owned||m.currency!=='NONE'||
  old.order.orderId!==data.order.orderId||!trainRowMatches(data.train,old.train)||!trainRowMatches(m,old.train)||!same(data.train.originalNeeds,old.train.originalNeeds)||
  !data.train.loadedCarriages.some(s=>s.slotId===slot.slotId&&s.itemId===slot.itemId&&s.required===slot.required&&s.loaded)||
  !same(data.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})),old.order.needs.filter(n=>n.slotId!==slot.slotId).map(({slotId,itemId,required})=>({slotId,itemId,required}))))return null;
 return {actionId:action.id,frameId:frame.id,confirmed:true,effect:data.departure?.departed?'The bound final carriage was loaded and the same train automatically departed.':'The selected carriage is loaded and its exact demand is absent from the same row.',
  orderId:old.order.orderId,inventoryInvalidated:[slot.itemId],trainLoadReceipt:{slotId:slot.slotId,itemId:slot.itemId,required:slot.required,
   loaded:true,remainingDemandConfirmed:true,stockAfterNotObserved:true}};
}
export function trainDetailResult(state,action,frame,data){
 const before=state.frames[action?.frameId],d=action?.target?.trainDetail;
 if(action?.target.kind!=='inspect_item'||!d||action.management||action.inputAttempted!==true||!['issued','captured'].includes(action.status)||
  !acceptedFacts(before)||before.review.reviewedBy!=='program-train-loading'||frame.epoch!==action.epoch||frame.sequence<=before.sequence||
  frame.evidenceHash===before.evidenceHash||(state.observationInvalidation?.sequence??-1)>=before.sequence||
  !Number.isFinite(Date.parse(action.issuedAt))||!Number.isFinite(Date.parse(frame.captureStartedAt))||
  Date.parse(frame.captureStartedAt)<Date.parse(action.issuedAt)+1000)return null;
 const old=before.review.data;
 if(d.rowEntry&&data.train.observationMode==='current_slots'){
  const n=data.order.needs.find(n=>n.slotId===d.slotId);
  if(d.orderId!==old.order.orderId||!trainRowMatches(data.train,d)||data.train.row===old.train.row||data.train.selectedCarriage!==d.slotId||
   n?.itemId!==d.itemId||n.required!==d.required)return null;
  return {actionId:action.id,frameId:frame.id,confirmed:true,effect:'The visible destination carriage is selected; current row demand is independently read.',
   row:d.row,slotId:d.slotId,itemId:d.itemId,fromOrderId:old.order.orderId,orderId:data.order.orderId,inventoryUnchanged:true};
 }
 if(d.rowEntryId){
  const profile=trainLoadingProfile(frame).profile,entry=(profile.rowEntries??[]).find(e=>e.id===d.rowEntryId),row=trainLoadingRow(profile,entry?.to);
  const original=row?.slots.map(({slotId,itemId,required})=>({slotId,itemId,required})),origin={frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,observedAt:frame.observedAt};
  if(!entry||!trainRowMatches(old.train,entry.from)||!trainRowMatches(data.train,entry.to)||!trainRowMatches(d,entry.to)||
   d.orderId!==old.order.orderId||data.order.orderId===old.order.orderId||data.train.selectedCarriage!==d.slotId||
   d.slotId!==entry.to.slotId||d.itemId!==entry.to.itemId||d.popupId!==entry.to.popupId||
   old.train.selectedCarriage!==profile.popups.find(p=>p.id===entry.from.popupId)?.slotId||
   data.train.fullDemandConfirmed!==true||data.train.loadedCarriages.length||!same(data.train.origin,origin)||!same(data.train.originalNeeds,original)||
   !same(data.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})),original)||
   ![transportAbbreviation('train'),'train'].some(prefix=>data.order.orderId===prefix+':r'+entry.to.row+':'+orderSignature(original)+':'+sha(origin).slice(0,16))||
   !trainLoadContextMatches(entry,old.train.loadedCarriages))return null;
  return {actionId:action.id,frameId:frame.id,confirmed:true,effect:'The registered next row detail is selected and its complete original demand is observed.',
   row:d.row,slotId:d.slotId,itemId:d.itemId,fromOrderId:old.order.orderId,orderId:data.order.orderId,inventoryUnchanged:true};
 }
 if(!trainRowMatches(data.train,d)||!trainRowMatches(old.train,d)||data.train.selectedCarriage!==d.slotId||data.order.orderId!==d.orderId||
  old.train.selectedCarriage===d.slotId||!same(data.train.originalNeeds,old.train.originalNeeds)||
  !same(data.train.loadedCarriages,old.train.loadedCarriages)||!same(data.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})),
   old.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required}))))return null;
 return {actionId:action.id,frameId:frame.id,confirmed:true,effect:'The requested carriage detail is selected with unchanged original and remaining demand.',
  row:d.row,slotId:d.slotId,itemId:d.itemId,orderId:d.orderId,inventoryUnchanged:true};
}
export async function observeTrainLoading(store,{frameId='latest',offline=false,temporaryContext=null}={},workers={}){
 const initial=store.load(),fid=frameId==='latest'?initial.latestFrameId:frameId;
 if(!offline&&(initial.stopCapture||initial.stopReader))fail('SESSION_STOPPED');
 if(!offline&&(fid!==initial.latestFrameId||initial.frames[fid]?.epoch!==initial.scene.epoch))fail('CURRENT_FRAME_REQUIRED');
 const evidence=store.evidence(fid),registration=trainLoadingProfile(evidence.frame),action=initial.actions[initial.input];
 const scope=action?.target?.management?.kind==='train'?action.target.management:
  action?.target?.kind==='load_train'?action.target.management:action?.target?.trainDetail??temporaryContext?.review.data.train;
 const reading=readTrainLoading(evidence.image,registration,scope);
 if(!reading.supported)return {...reading,stored:false,frameId:fid};
 if(!offline&&(initial.observationInvalidation?.sequence??-1)>=evidence.frame.sequence)fail('OBSERVATION_CONTEXT_CHANGED');
 const prior=evidence.frame.review;
 if(!offline&&!initial.input&&prior?.reviewedBy==='program-train-loading'){
  validateTrainLoadingProof(evidence.frame);
  if(prior.proof.invalidationSequence!==(initial.observationInvalidation?.sequence??null))fail('OBSERVATION_CONTEXT_CHANGED');
  return {...reading,stored:true,frameId:fid,review:prior,reused:true};
 }
 const rewardHandoff=!offline&&!initial.input&&prior?.reviewedBy==='program-train-reward';
 if(rewardHandoff){
  validateTrainRewardProof(evidence.frame);
  if(prior.proof.invalidationSequence!==(initial.observationInvalidation?.sequence??null))fail('OBSERVATION_CONTEXT_CHANGED');
 }
 const fields=reading.fields??(reading.field?[reading.field]:[]);
 const ocrWorker=fields.length?(workers.ocr??new RapidOcrWorker()):null;
 try{
  const ocr=ocrWorker?await ocrWorker.analyze(evidence.frame,evidence.bytes,{offline:true,scene:'train',fields}):null;
  const analysisState=offline?{...initial,input:null,actions:{}}:initial;
  const decoded=decodeTrainLoading(analysisState,evidence.frame,reading,ocr,{registration,temporaryContext,now:store.clock()}),review=decoded.review;
  const row=trainLoadingRow(registration.profile,reading);
  const open=independentTrain(registration)?reading.slots.filter(s=>!s.loaded):row?.slots.filter(s=>reading.slots.some(n=>n.slotId===s.slotId&&!n.loaded))??[];
  const identity=await inspectDeliveryIdentities(evidence,open.map(s=>({slotId:s.slotId,nativeItemId:s.itemId,box:s.iconBox??s.item.box,overlayTop:s.quantity?.box.y-2})),workers.matcher);
  const productRecognition=deliveryIdentityEvidence(reading,identity,open);
  if(productRecognition)review.data.train.productRecognition=productRecognition;
  const reentry=decoded.contextFrameId&&initial.frames[decoded.contextFrameId]?.epoch!==evidence.frame.epoch?
    {actions:sha(initial.actions),context:sha(initial.frames[decoded.contextFrameId])}:null;
  const result=offline?null:trainLoadResult(initial,initial.actions[initial.input],evidence.frame,review.data);
  const navigation=offline?null:trainDetailResult(initial,initial.actions[initial.input],evidence.frame,review.data);
  if(!offline&&initial.input&&!result&&!navigation)fail('TRAIN_SAME_CARRIAGE_RESULT_REQUIRED');
  if(result)review.data.actionResult=result;
  if(navigation)review.data.trainDetailResult=navigation;
  // MumuStore retains accepted data when the same original gets a new review.
  // Bind that retained receipt into the new proof; action.resultProof stays immutable.
  if(rewardHandoff)review.data={...structuredClone(prior.data),...review.data};
  review.proof={schema:'program-train-loading-1',frameId:fid,evidenceHash:evidence.frame.evidenceHash,profileHash:registration.hash,
   ...(productRecognition?{productRecognition:{catalogueManifestSha256:productRecognition.catalogueManifestSha256,thresholdSha256:productRecognition.thresholdSha256}}:{}),
   inputId:offline?null:initial.input,invalidationSequence:initial.observationInvalidation?.sequence??null,contextFrameId:decoded.contextFrameId,
   fieldsHash:sha(ocr?.fields??[]),...(independentTrain(registration)?{numericFields:ocr.fields,slotReading:reading}:{}),reviewHash:reviewFactHash(review)};
  if(!offline){
   const current=store.load();
   if(current.latestFrameId!==fid||current.input!==initial.input||current.stopCapture||current.stopReader||current.scene.epoch!==evidence.frame.epoch||
    sha(current.session.management)!==sha(initial.session.management)||
    sha(current.frames[fid]?.review)!==sha(prior)||
    sha(current.frames[decoded.contextFrameId]?.review)!==sha(initial.frames[decoded.contextFrameId]?.review)||
    (current.observationInvalidation?.sequence??null)!==(initial.observationInvalidation?.sequence??null))fail('OBSERVATION_CONTEXT_CHANGED');
   await store.retry(()=>store.pinFrame(fid,{ocr:false}));
   await store.retry(()=>{
    const transact=store.transact;
    try{
     if(reentry)store.transact=fn=>transact.call(store,s=>{
      if(sha(s.actions)!==reentry.actions||sha(s.frames[decoded.contextFrameId])!==reentry.context)fail('TRAIN_REENTRY_CONTEXT_CHANGED');
      return fn(s);
     });
     return store.review({frameId:fid,...review,programToken:PROGRAM_REVIEW_TOKEN});
    }finally{store.transact=transact;}
   });
  }
  return {...reading,stored:!offline,frameId:fid,review,ocr};
 }finally{if(ocrWorker&&!workers.ocr)ocrWorker.close();}
}
export function trainLoadingPlan(state,reading){
 const target=reading.review?.targets?.find(t=>t.kind==='load_train');
 if(!target||target.management?.resultRegistrationRequired===true)return null;
 const id=generatedActionId(state,{frameId:reading.frameId,targetId:target.id,kind:'l'},()=> 'train-load:'+sha({session:state.session.id,frame:reading.frameId,target:target.id}).slice(0,32)),m=target.management;
 return {source:'explicit_user',missionId:id,sessionId:state.session.id,maxCoins:0,steps:[{actionId:id,kind:'load_train',
  frameId:reading.frameId,targetId:target.id,orderId:m.orderId,itemId:m.itemId,maxUnits:m.required,nextVisit:{visitId:id+'-result',kind:'train',required:true}}]};
}
// Already valid stock, including zero, needs no visit. An evidenced load gets
// priority over reading other quantities. A feasible native carriage may need
// its first detail original; that one inspection stays pending until registered.
// An already registered unsupported detail is not revisited for that purpose.
export function selectTrainDetail(reading,allocation,registration=trainLoadingProfile()){
 const data=reading.review.data,all=reading.review.targets.filter(t=>t.kind==='inspect_item'&&t.trainDetail),targets=all.filter(t=>!t.trainDetail.rowEntryId&&!t.trainDetail.rowEntry);
 const entry=independentTrain(registration)?all.find(t=>{
  const d=t.trainDetail;if(!d.rowEntry)return false;
  const previous=allocation.orderSources?.find(o=>o.transport==='train'&&o.location?.layoutId===d.layoutId);
  if(!previous)return true;
  const n=previous.needs.find(n=>n.slotId===d.slotId),stock=allocation.projection?.items?.[d.itemId];
  if(!n)return false;
  if(stock?.fresh!==true)return true;
  const e=allocation.evaluations.find(o=>o.orderId===previous.orderId),reserve=allocation.projection.reservations.filter(r=>r.orderId===previous.orderId&&r.itemId===d.itemId).reduce((n,r)=>n+r.quantity,0);
  return previous.needs.length>1&&trainAllocationAllowsCarriage(e)&&stock.quantity>=n.required&&reserve>=n.required;
 }):null;
 if(!data.train.fullDemandConfirmed||data.order.disposition!=='deliver')return entry;
 const order=allocation.evaluations?.find(o=>o.orderId===data.order.orderId),items=allocation.projection?.items??{};
 const reserve=itemId=>(allocation.projection?.reservations??[]).filter(r=>r.orderId===data.order.orderId&&r.itemId===itemId).reduce((n,r)=>n+r.quantity,0);
 return targets.find(t=>{
  const d=t.trainDetail,n=data.order.needs.find(n=>n.slotId===d.slotId),stock=items[d.itemId];
  return trainAllocationAllowsCarriage(order)&&stock?.fresh===true&&stock.quantity>=n.required&&reserve(d.itemId)>=n.required&&
   (independentTrain(registration)?data.order.needs.length>1:
    registration.profile.loadTransitions.some(r=>trainRowMatches(r,d)&&r.slotId===d.slotId&&r.itemId===d.itemId&&trainLoadContextMatches(r,data.train.loadedCarriages))||
    registration.profile.provider==='google_play_windows'&&!registration.profile.popups.some(p=>p.id===d.popupId));
 })??targets.find(t=>items[t.trainDetail.itemId]?.fresh!==true)??
  entry??(order&&order.status!=='hold'&&data.order.needs.every(n=>items[n.itemId]?.fresh===true&&items[n.itemId].quantity<n.required)?all.find(t=>t.trainDetail.rowEntryId):null)??null;
}
