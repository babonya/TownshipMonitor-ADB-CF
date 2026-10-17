import {resolvePercentageProfile} from './percentage-profile.mjs';
// Bounded ordinary train recognition. Unregistered rows, digits and popups abstain.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng} from './adb.mjs';
import {acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
import {matchRegisteredRegion} from './mumu-region-match.mjs';
import {trainSlotIcon} from './mumu-item-regions.mjs';
import {gameTransform,nativeBox} from './windows-coordinate-space.mjs';
import {independentTrain,readTrainSlots,trainSlotTargets,validateTrainSlotProof} from './mumu-train-slots.mjs';
import {validateProductDependencies} from './mumu-product-recognition.mjs';
export function trainLoadingProfile(context,issuedSourceHash=null){
 const native=context?.provider==='google_play_windows';
 if(issuedSourceHash!==null&&(!native||!/^[a-f0-9]{64}$/.test(issuedSourceHash)))throw Error('TRAIN_LOADING_PROFILE_CHANGED');
 const file=new URL(native?'../reference/image-matching/google-play/train-loading/'+(issuedSourceHash?'profile-'+issuedSourceHash+'.json':'profile.json'):'../reference/train-loading/profile.json',import.meta.url);
 const bytes=readFileSync(file),profile=resolvePercentageProfile(JSON.parse(bytes),{historical:!!issuedSourceHash}),assets=new Map();
 if(issuedSourceHash&&digest(bytes)!==issuedSourceHash)throw Error('TRAIN_LOADING_PROFILE_CHANGED');
 if(profile.schema!==1||profile.identityMode!=='product_list'||native&&profile.provider!==context.provider)throw Error('TRAIN_LOADING_PROFILE_CHANGED');
 const validateRounding=value=>{
  if(!value||typeof value!=='object')return;
  if(Object.hasOwn(value,'exactChannelTolerance')&&(!native||value.exact!==true||value.exactChannelTolerance!==2))throw Error('TRAIN_LOADING_TOLERANCE_INVALID');
  for(const child of Object.values(value))validateRounding(child);
 };validateRounding(profile);
 if(native)for(const b of profile.coordinateBindings){if(JSON.stringify(nativeBox(b.fraction,gameTransform(profile.coordinateSpace)))!==JSON.stringify(b.box))throw Error('TRAIN_LOADING_COORDINATE_CHANGED');}
 for(const a of profile.assets){
  if(a.file!==a.file.split(/[\\/]/).at(-1))throw Error('TRAIN_LOADING_ASSET_CHANGED');
  const data=readFileSync(join(dirname(fileURLToPath(file)),a.file));
  if(digest(data)!==a.sha256)throw Error('TRAIN_LOADING_ASSET_CHANGED');
  assets.set(a.file,decodePng(data));
 }
 return {profile,assets,hash:digest(bytes)};
}
function matches(image,spec,assets){
 const template=assets.get(spec.file),b=spec.box;
 if(!template||template.width!==b.width||template.height!==b.height||b.x<0||b.y<0||b.x+b.width>image.width||b.y+b.height>image.height)return false;
 let changed=0;
 for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const p=((b.y+y)*image.width+b.x+x)*image.channels,q=(y*b.width+x)*template.channels;
  // Five native reentry regions exhibit at most two channel levels of variation.
  // Every pixel must stay within that bound; live critical preflight is unchanged.
  if([0,1,2].some(c=>Math.abs(image.pixels[p+c]-template.pixels[q+c])>(spec.exact?(spec.exactChannelTolerance??0):12)))changed++;
 }
 return spec.exact?changed===0:changed/(b.width*b.height)<=.03;
}
export function trainRowMatches(a,b){return !!a&&!!b&&a.row===b.row&&a.layoutId===b.layoutId;}
export function trainLoadingRow(profile,scope){const rows=profile.rows.filter(r=>trainRowMatches(r,scope));return rows.length===1?rows[0]:null;}
const layoutFields=row=>row.layoutId?{layoutId:row.layoutId}:{};
function openSlot(image,slot,assets,row){return matches(image,slot.body,assets)&&
 (matches(image,slot.item,assets)||matchRegisteredRegion(image,{...slot.item,exact:false},assets.get(slot.item.file),{icons:[trainSlotIcon(row,slot)]}))&&
 [slot.quantity,...(slot.quantityAlternatives??[])].some(a=>matches(image,a,assets));}
function barePartialMatches(image,row,profile,assets){
 if(profile.provider!=='google_play_windows')return false;
 if(row.barePartialProof==='tracked_slot_states'){
  let loaded=0;
  for(const s of row.slots){
   const regions=row.loaded.find(l=>l.slotId===s.slotId)?.regions;
   const checked=!!regions?.length&&regions.every(a=>matches(image,a,assets)),open=openSlot(image,s,assets,row);
   if(checked===open)return false;if(checked)loaded++;
  }
  return loaded>0&&loaded<row.slots.length;
 }
 return (row.bareLoadedStates??[]).some(loaded=>loaded.length&&loaded.length<row.slots.length&&row.slots.every(s=>loaded.includes(s.slotId)?
  !openSlot(image,s,assets,row)&&row.loaded.find(l=>l.slotId===s.slotId)?.regions.every(a=>matches(image,a,assets)):openSlot(image,s,assets,row)));
}
export function readTrainLoading(image,registration=trainLoadingProfile(),scope=null){
 if(registration.profile.provider==='google_play_windows'&&(image.width!==registration.profile.dimensions.width||image.height!==registration.profile.dimensions.height))return {supported:false,reason:'TRAIN_LOADING_GEOMETRY_EVIDENCE_REQUIRED',observedDimensions:{width:image.width,height:image.height},registeredDimensions:registration.profile.dimensions,executionAllowed:false};
 if(independentTrain(registration))return readTrainSlots(image,registration,matches,scope);
 const {profile,assets}=registration;
 const hold=reason=>({supported:false,reason,executionAllowed:false});
 if(image.width!==profile.dimensions.width||image.height!==profile.dimensions.height||image.channels<3||!profile.anchors.every(a=>matches(image,a,assets)))return hold('TRAIN_LOADING_LAYOUT_REQUIRED');
 const popups=profile.popups.filter(p=>p.anchors.every(a=>matches(image,a,assets))&&matches(image,p.item,assets));
 const departed=popups.length===0?(profile.automaticDepartures??[]).filter(d=>d.regions.every(a=>matches(image,a,assets))):[];
 if(departed.length===1){
  const row=trainLoadingRow(profile,departed[0]);if(!row)return hold('TRAIN_LOADING_LAYOUT_REQUIRED');
  // This is only a result candidate. Decoder requires the bound final load.
  return {supported:true,row:row.row,...layoutFields(row),slots:row.slots.map(s=>({slotId:s.slotId,loaded:true})),departed:true,
   selectedCarriage:null,popupId:null,field:null,freeLoad:false,executionAllowed:false};
 }
 // Bare rows prove visible demand, never owned stock or a load button. A native
 // partial state additionally needs prior demand and a verified navigation chain.
 // Its clear-panel strip is covered by every detail popup for that row.
 const bare=popups.length===0?profile.rows.filter(r=>r.bareAnchors?.length&&r.bareAnchors.every(a=>matches(image,a,assets))&&
  (r.slots.every(s=>openSlot(image,s,assets,r))||barePartialMatches(image,r,profile,assets))):[];
 if(popups.length!==1&&!(popups.length===0&&bare.length===1))return hold('REGISTERED_TRAIN_POPUP_REQUIRED');
 const popup=popups[0]??null,row=popup?trainLoadingRow(profile,popup):bare[0],slots=[];
 if(!row)return hold('TRAIN_LOADING_LAYOUT_REQUIRED');
 for(const s of row.slots){
  const regions=row.loaded.find(l=>l.slotId===s.slotId)?.regions;
  const loaded=!!regions?.length&&regions.every(a=>matches(image,a,assets));
  const open=openSlot(image,s,assets,row);
  if(loaded===open)return hold('TRAIN_FULL_ROW_REQUIRED');
  slots.push(open?{slotId:s.slotId,itemId:s.itemId,required:s.required,loaded:false}:{slotId:s.slotId,loaded:true});
 }
 if(!popup)return {supported:true,row:row.row,...layoutFields(row),slots,selectedCarriage:null,popupId:null,field:null,freeLoad:false,executionAllowed:false,
  ...(slots.some(s=>s.loaded)?{barePartial:true}:{})};
 const selected=slots.find(s=>s.slotId===popup.slotId);
 if(selected?.loaded!==false||selected.itemId!==popup.itemId)return hold('TRAIN_SELECTED_CARRIAGE_REQUIRED');
 return {supported:true,row:row.row,...layoutFields(row),slots,selectedCarriage:popup.slotId,popupId:popup.id,
  field:structuredClone(popup.field),freeLoad:matches(image,popup.load,assets),executionAllowed:false,
  ...(profile.rowEntries?.length?{rowEntries:profile.rowEntries.filter(e=>trainRowMatches(e.from,row)&&e.from.popupId===popup.id&&
   trainLoadContextMatches(e,slots.filter(s=>s.loaded))&&e.regions.every(a=>matches(image,a,assets))).map(e=>e.id)}:{})};
}
export function trainLoadingTargets(reading,data,registration=trainLoadingProfile()){
 if(independentTrain(registration))return trainSlotTargets(reading,data,registration);
 const p=registration.profile.popups.find(p=>p.id===reading.popupId),row=trainLoadingRow(registration.profile,reading);
 const n=data.order.needs.find(n=>n.slotId===reading.selectedCarriage);
 const transition=n&&registration.profile.loadTransitions.some(t=>trainRowMatches(t,reading)&&t.slotId===n.slotId&&t.itemId===n.itemId&&trainLoadContextMatches(t,data.train.loadedCarriages));
 // Retain the historical source target for proof compatibility. Ordinary
 // planning and input reject it until a matching result is registered.
 const nativeSource=registration.profile.provider==='google_play_windows'&&p&&n&&trainRowMatches(p,reading)&&p.slotId===n.slotId&&p.itemId===n.itemId;
 if(!p||!n||data.train.fullDemandConfirmed!==true||data.order.disposition!=='deliver'||(!transition&&!nativeSource)||
  !reading.freeLoad||!Number.isSafeInteger(n.owned)||n.owned<n.required)return trainDetailTargets(reading,data,registration);
 // Full request strips are exact, so an added digit cannot be masked by a large icon.
 return [{id:'train-load:'+n.slotId,kind:'load_train',type:'tap',box:p.load.box,
  management:{purpose:'transport',verified:true,programVerified:true,currency:'NONE',itemId:n.itemId,
   required:n.required,owned:n.owned,orderId:data.order.orderId,row:reading.row,...layoutFields(reading),slotId:n.slotId,...(!transition?{resultRegistrationRequired:true}:{})},
  verification:{version:1,anchorBoxes:[registration.profile.anchors[0],p.anchors[0],p.anchors[2]].map(a=>a.box),targetRegions:[p.load.box],
   criticalRegions:[{field:'stock',box:p.field.box},...row.slots.map(s=>({field:'order_grid',box:s.gridBox??{x:s.body.box.x,y:s.body.box.y,width:135,height:89}}))]}} ,...trainDetailTargets(reading,data,registration)];
}
export function trainLoadContextMatches(transition,loaded){
 return !transition.requiredLoadedSlots||JSON.stringify([...transition.requiredLoadedSlots].sort())===JSON.stringify(loaded.map(s=>s.slotId).sort());
}
export function trainLoadResultPopupMatches(transition,reading,registration){
 if(transition.resultPopupMode!=='same_row')return transition.resultPopupId===reading.popupId;
 // Only independently registered open destination details in the pilot row.
 // Source loaded-slot support remains explicitly bounded by the transition.
 return !reading.departed&&registration.profile.popups.some(p=>p.id===reading.popupId&&trainRowMatches(p,reading)&&
  p.slotId===reading.selectedCarriage&&reading.slots.some(s=>s.slotId===p.slotId&&!s.loaded&&s.itemId===p.itemId));
}
// Per-carriage reservations survive unknown stock for other products. All other
// holds remain authoritative; callers still check the selected exact pair,
// supported result, full demand and current reservation at the input boundary.
export function trainAllocationAllowsCarriage(order){
 return order?.transport==='train'&&(['feasible','shortage'].includes(order.status)||
  order.status==='hold'&&Array.isArray(order.reasons)&&order.reasons.length>0&&order.reasons.every(r=>['STOCK_UNKNOWN_OR_STALE','OWNED_COUNT_UNKNOWN'].includes(r)));
}
export function trainDetailTargets(reading,data,registration=trainLoadingProfile()){
 if(independentTrain(registration))return trainSlotTargets(reading,data,registration).filter(t=>t.kind==='inspect_item');
 if(data.train.fullDemandConfirmed!==true||data.order.disposition!=='deliver')return [];
 const row=trainLoadingRow(registration.profile,reading),popup=registration.profile.popups.find(p=>p.id===reading.popupId);
 if(!row||(!popup&&!row.bareAnchors?.length))return [];
 const targets=(registration.profile.detailSelections??[]).filter(d=>trainRowMatches(d,reading)&&d.slotId!==reading.selectedCarriage&&
  reading.slots.some(s=>s.slotId===d.slotId&&!s.loaded&&s.itemId===d.itemId)).map(d=>({
   id:'train-detail:'+d.slotId,kind:'inspect_item',type:'tap',box:d.box,
   trainDetail:{row:d.row,...layoutFields(d),slotId:d.slotId,itemId:d.itemId,popupId:d.popupId,orderId:data.order.orderId},
   verification:{version:1,anchorBoxes:[registration.profile.anchors[0],...(popup?[popup.anchors[0],popup.anchors[2]]:row.bareAnchors)].map(a=>a.box),targetRegions:[d.box],
    criticalRegions:[...(popup?[{field:'stock',box:popup.field.box}]:[]),...row.slots.map(s=>({field:'order_grid',box:s.gridBox??{x:s.body.box.x,y:s.body.box.y,width:135,height:89}}))]}
  }));
 return [...targets,...(registration.profile.rowEntries??[]).filter(e=>reading.rowEntries?.includes(e.id)).map(e=>rowEntryTarget(e,data,registration))];
}
function rowEntryTarget(entry,data,registration){
 const row=trainLoadingRow(registration.profile,data.train),popup=registration.profile.popups.find(p=>p.id===entry.from.popupId),d=entry.to;
 const boxes=entry.regions.map(a=>a.box),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
 const destination={x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
 return {id:'train-row-detail:'+d.slotId,kind:'inspect_item',type:'tap',box:entry.box,
  trainDetail:{row:d.row,...layoutFields(d),slotId:d.slotId,itemId:d.itemId,popupId:d.popupId,orderId:data.order.orderId,rowEntryId:entry.id},
  verification:{version:1,anchorBoxes:[registration.profile.anchors[0],popup.anchors[0],popup.anchors[2]].map(a=>a.box),targetRegions:[entry.box],
   criticalRegions:[{field:'stock',box:popup.field.box},...row.slots.filter(s=>data.order.needs.some(n=>n.slotId===s.slotId)).map(s=>({field:'order_grid',box:s.gridBox})),{field:'destination_carriage',box:destination}]}};
}
function validDetailTarget(target,data,registration){
 if(target.trainDetail?.rowEntryId){
  const entry=(registration.profile.rowEntries??[]).find(e=>e.id===target.trainDetail.rowEntryId);
  return !!entry&&trainRowMatches(entry.from,data.train)&&trainLoadContextMatches(entry,data.train.loadedCarriages)&&
   registration.profile.popups.some(p=>p.id===entry.from.popupId&&p.slotId===data.train.selectedCarriage)&&
   JSON.stringify(target)===JSON.stringify(rowEntryTarget(entry,data,registration));
 }
 const d=(registration.profile.detailSelections??[]).find(d=>trainRowMatches(d,data.train)&&d.slotId===target.trainDetail?.slotId);
 return d&&target.kind==='inspect_item'&&target.id==='train-detail:'+d.slotId&&target.type==='tap'&&!target.management&&
  JSON.stringify(target.box)===JSON.stringify(d.box)&&target.trainDetail.popupId===d.popupId&&trainRowMatches(target.trainDetail,d)&&
  target.trainDetail.itemId===d.itemId&&target.trainDetail.orderId===data.order.orderId&&
  d.slotId!==data.train.selectedCarriage&&data.order.needs.some(n=>n.slotId===d.slotId&&n.itemId===d.itemId);
}
export function validateTrainLoadingProof(frame,registration=trainLoadingProfile(frame)){
 if(frame.review?.reviewedBy!=='program-train-loading')return;
 validateProductDependencies(frame.review.proof?.productRecognition);
 if(independentTrain(registration))return validateTrainSlotProof(frame,registration);
 const r=frame.review,p=r.proof,row=trainLoadingRow(registration.profile,r.data?.train);
 const original=row?.slots.map(({slotId,itemId,required})=>({slotId,itemId,required}));
 const full=r.data.train?.fullDemandConfirmed===true;
 const demandValid=full?r.data.order?.orderConfirmed===true&&JSON.stringify(original)===JSON.stringify(r.data.train.originalNeeds):
  r.data.train?.fullDemandConfirmed===false&&r.data.order?.orderConfirmed===false&&r.data.order?.disposition==='hold'&&
  r.data.train.originalNeeds===null&&r.data.train.origin===null&&r.targets.length===0;
 if(!acceptedFacts(frame)||p.profileHash!==registration.hash||p.reviewHash!==reviewFactHash(r)||
  r.actualKind!=='train'||!demandValid||r.data.order?.identityMode!=='product_list'||!original||
  r.targets.some(t=>t.kind==='inspect_item'?!validDetailTarget(t,r.data,registration):t.kind!=='load_train'||t.management?.programVerified!==true||!trainRowMatches(t.management,r.data.train)))throw Error('TRAIN_LOADING_PROOF_CHANGED');
}
export function verifyTrainLoadingPreflight(frame,image,target){
 if(frame.review?.reviewedBy!=='program-train-loading')throw Error('TRAIN_LOADING_SCOPE_REQUIRED');
 validateTrainLoadingProof(frame);
 const registration=trainLoadingProfile(frame),reading=readTrainLoading(image,registration,frame.review.data.train);
 if(!reading.supported||!trainRowMatches(reading,frame.review.data.train)||reading.selectedCarriage!==frame.review.data.train.selectedCarriage||target.kind==='load_train'&&!reading.freeLoad||
  target.trainDetail?.rowEntryId&&!reading.rowEntries?.includes(target.trainDetail.rowEntryId))
  throw Error('NAVIGATION_TARGET_CHANGED');
 // The immediate preflight checks every numeric pixel exactly. Reusing the
 // sealed OCR observation avoids inventing new OCR facts from this capture.
 const project=independentTrain(registration)?({slotId,itemId})=>({slotId,itemId}):({slotId,itemId,required})=>({slotId,itemId,required});
 const current=reading.slots.filter(s=>!s.loaded).map(project);
 const expected=frame.review.data.order.needs.map(project);
 if(independentTrain(registration)&&JSON.stringify(reading.slots.filter(s=>s.loaded).map(s=>s.slotId).sort())!==JSON.stringify(frame.review.data.train.loadedCarriages.map(s=>s.slotId).sort()))throw Error('NAVIGATION_TARGET_CHANGED');
 if(JSON.stringify(current)!==JSON.stringify(expected)||!frame.review.targets.some(t=>JSON.stringify(t)===JSON.stringify(target)))throw Error('NAVIGATION_TARGET_CHANGED');
}
// Restrict the Windows consumptive gate to the complete current program target.
// Source proof and target geometry are checked here; live pixels are checked by
// the existing immediate preflight before the native input adapter can dispatch.
export function validNativeTrainLoad(frame,target){
 if(frame?.provider!=='google_play_windows'||frame.review?.reviewedBy!=='program-train-loading'||target?.kind!=='load_train')return false;
 try{
  const registration=trainLoadingProfile(frame);validateTrainLoadingProof(frame,registration);
  if(independentTrain(registration))return frame.review.targets.some(t=>t.kind==='load_train'&&JSON.stringify(t)===JSON.stringify(target));
  const data=frame.review.data,scope=data.train;
  const popups=registration.profile.popups.filter(p=>trainRowMatches(p,scope)&&p.slotId===scope.selectedCarriage);
  if(popups.length!==1)return false;
  const reading={row:scope.row,...layoutFields(scope),selectedCarriage:scope.selectedCarriage,popupId:popups[0].id,freeLoad:true,
   slots:data.order.needs.map(n=>({...n,loaded:false}))};
  const expected=trainLoadingTargets(reading,data,registration).find(t=>t.kind==='load_train');
  return !!expected&&JSON.stringify(expected)===JSON.stringify(target);
 }catch{return false;}
}
