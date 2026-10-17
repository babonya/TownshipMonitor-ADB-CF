// Native train geometry and known artwork are reusable; demands are observations.
import {digest} from './adb.mjs';
import {transportAbbreviation} from './mumu-transport-id.mjs';
import {acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
import {matchRegisteredRegion,iconOccurrence} from './mumu-region-match.mjs';
import {orderDisposition,orderSignature} from './mumu-order-policy.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=v=>digest(Buffer.from(JSON.stringify(v)));
const need=slots=>slots.filter(s=>!s.loaded).map(({slotId,itemId,required})=>({slotId,itemId,required}));
const ids=slots=>slots.filter(s=>s.loaded).map(s=>s.slotId).sort();
const fail=reason=>{throw Error(reason);};
const shift=(spec,dx,dy)=>({...spec,box:{...spec.box,x:spec.box.x+dx,y:spec.box.y+dy}});
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
export const independentTrain=registration=>registration.profile.recognitionMode==='independent_slots';
function quantityField(slot,itemId,locator=null){
 const field={...slot.quantityField,itemId};
 return locator?{...field,kind:'quantity',box:{x:locator.box.x+locator.box.width,y:locator.box.y,width:slot.body.box.x+97-locator.box.x-locator.box.width,height:locator.box.height}}:field;
}
export function trainSlotPopup(profile,row,slot,itemId){
 const frame=profile.popupFrames.find(p=>p.row===row.row),dx=slot.body.box.x-frame.origin.x,dy=slot.body.box.y-frame.origin.y;
 return {id:'train-popup:'+slot.slotId,row:row.row,layoutId:row.layoutId,slotId:slot.slotId,itemId,
  anchors:frame.anchors.map(s=>shift(s,dx,dy)),load:shift(frame.load,dx,dy),
  field:{...frame.field,box:shift(frame.field,dx,dy).box,fieldId:'train-stock:'+slot.slotId,slotId:slot.slotId,itemId}};
}
function slotState(image,row,slot,registration,matches){
 const {profile,assets}=registration,b=slot.body.box;
 const loaded=row.loadedTemplates.some(t=>t.regions.every(s=>matches(image,shift(s,b.x-t.origin.x,b.y-t.origin.y),assets)));
 const candidates=[];
 if(matches(image,slot.body,assets))for(const item of profile.items){
  const variant=item.variants.find(v=>{
   const spec={...v.region,box:{...v.region.box,x:b.x+v.offset.x,y:b.y+v.offset.y}};
   return matches(image,spec,assets)||matchRegisteredRegion(image,{...spec,exact:false},assets.get(spec.file),
    {icons:[iconOccurrence('train:'+slot.slotId,item.itemId,spec.box,[slot.quantityField.box])]});
  });if(variant)candidates.push({itemId:item.itemId,iconBox:{...variant.region.box,x:b.x+variant.offset.x,y:b.y+variant.offset.y}});
 }
 if(loaded&&candidates.length||!loaded&&candidates.length!==1)return null;
 return loaded?{slotId:slot.slotId,loaded:true}:{slotId:slot.slotId,...candidates[0],loaded:false};
}
export function readTrainSlots(image,registration,matches,scope=null){
 const {profile,assets}=registration,hold=reason=>({supported:false,reason,executionAllowed:false});
 if(image.width!==profile.dimensions.width||image.height!==profile.dimensions.height||image.channels<3||
  !profile.anchors.every(s=>matches(image,s,assets)))return hold('TRAIN_LOADING_LAYOUT_REQUIRED');
 const popups=[];
 for(const row of profile.rows)for(const slot of row.slots){
  const p=trainSlotPopup(profile,row,slot,null);
  const frame=profile.popupFrames.find(f=>f.row===row.row),b=slot.body.box;
  if(frame.variants.some(v=>v.anchors.every(s=>matches(image,shift(s,b.x-v.origin.x,b.y-v.origin.y),assets))))popups.push(p);
 }
 if(popups.length>1)return hold('TRAIN_POPUP_GEOMETRY_AMBIGUOUS');
 const rows=popups.length?profile.rows.filter(r=>r.row===popups[0].row):profile.rows.filter(r=>r.bareAnchors.length&&r.bareAnchors.every(s=>matches(image,s,assets)));
 const readings=[];
 for(const row of rows){
  if(!row.layoutAnchors.every(s=>matches(image,s,assets)))continue;
  const slots=row.slots.map(s=>slotState(image,row,s,registration,matches));
  if(slots.some(s=>!s)||slots.every(s=>s.loaded))continue;
  const selected=popups[0]?slots.find(s=>s.slotId===popups[0].slotId):null;
  if(selected?.loaded)continue;
  const popup=selected?trainSlotPopup(profile,row,row.slots.find(s=>s.slotId===selected.slotId),selected.itemId):null;
  const quantityLocators={};let ambiguous=false;
  const fields=row.slots.filter(s=>slots.find(n=>n.slotId===s.slotId).loaded===false).map(s=>{
   const found=[];
   for(const g of profile.multiplierGlyphs)for(let x=s.body.box.x+20;x<=s.body.box.x+69;x++){
    const spec={file:g.file,box:{x,y:s.quantityField.box.y,width:g.width,height:g.height}};
    if(matches(image,spec,assets))found.push(spec);
   }
   if(new Set(found.map(f=>f.box.x)).size>1)ambiguous=true;
   if(found.length)quantityLocators[s.slotId]=found[0];
   return quantityField(s,slots.find(n=>n.slotId===s.slotId).itemId,found[0]);
  });
  if(ambiguous)continue;
  const destinations=[];
  const panel=popup?{x:popup.anchors[0].box.x-5,y:Math.min(...popup.anchors.map(a=>a.box.y))-22,width:350,
   height:Math.max(...popup.anchors.map(a=>a.box.y+a.box.height))-Math.min(...popup.anchors.map(a=>a.box.y))+44}:null;
  for(const other of profile.rows.filter(r=>r.row!==row.row))for(const s of other.slots){
   if(panel&&(overlaps(s.gridBox,panel)||overlaps(s.selectBox,panel)))continue;
   const n=slotState(image,other,s,registration,matches);if(!n||n.loaded)continue;
   destinations.push({...n,row:other.row,layoutId:other.layoutId});fields.push(quantityField(s,n.itemId));
  }
  if(popup)fields.push(popup.field);
  readings.push({supported:true,observationMode:'current_slots',row:row.row,layoutId:row.layoutId,slots,
   selectedCarriage:selected?.slotId??null,popupId:popup?.id??null,field:popup?.field??null,fields,quantityLocators,destinations,
   freeLoad:!!popup&&profile.popupFrames.find(f=>f.row===row.row).variants.some(v=>matches(image,shift(v.load,
    row.slots.find(s=>s.slotId===selected.slotId).body.box.x-v.origin.x,row.slots.find(s=>s.slotId===selected.slotId).body.box.y-v.origin.y),assets)),executionAllowed:false,...!popup&&slots.some(s=>s.loaded)?{barePartial:true}:{}});
 }
 const selected=scope?readings.find(r=>r.row===scope.row&&r.layoutId===scope.layoutId):readings.find(r=>r.slots.every(s=>!s.loaded))??readings[0];
 return selected??hold('TRAIN_SLOT_ARTWORK_OR_STATE_REQUIRED');
}
export function readTrainSlotNumbers(frame,reading,ocr){
 if(!ocr||ocr.frameId!==frame.id||ocr.evidenceHash!==frame.evidenceHash||ocr.sequence!==frame.sequence||ocr.epoch!==frame.epoch||
  ocr.observedAt!==frame.observedAt||ocr.scene!=='train'||ocr.fields?.length!==reading.fields.length)fail('TRAIN_OCR_FRAME_BINDING_REQUIRED');
 const slots=structuredClone(reading.slots),destinations=structuredClone(reading.destinations??[]);let stock=null;
 for(const [i,field]of reading.fields.entries()){
  const f=ocr.fields[i],raw=(f.rawText??'').replace(/\s/g,'');
  if(f.fieldId!==field.fieldId||f.kind!==field.kind||f.itemId!==field.itemId||f.slotId!==field.slotId||
   !same(f.box,field.box)||f.scale!==field.scale||f.recognitionOnly!==true)fail('TRAIN_CURRENT_QUANTITY_REQUIRED');
  const valid=f.status==='parsed_candidate'&&Array.isArray(f.ocrScores)&&f.ocrScores.length&&f.ocrScores.every(s=>Number.isFinite(s)&&s>=field.minimumScore&&s<=1);
  const destination=destinations.find(n=>n.slotId===field.slotId);
  if(!valid){if(destination)continue;fail('TRAIN_CURRENT_QUANTITY_REQUIRED');}
  if(['bundle_quantity','quantity'].includes(field.kind)){
   const m=(field.kind==='quantity'?/^([0-9]{1,6})$/:/^[xX×]?([0-9]{1,6})$/).exec(raw);
   if(!m||!Number.isSafeInteger(f.value)||f.value<=0||Number(m[1])!==f.value){if(destination)continue;fail('TRAIN_CURRENT_QUANTITY_REQUIRED');}
   (destination??slots.find(s=>s.slotId===field.slotId)).required=f.value;
  }else{
   const m=/^([0-9]{1,6})\/([0-9]{1,6})$/.exec(raw),v=f.value;
   if(!m||!Number.isSafeInteger(v?.owned)||v.owned<0||!Number.isSafeInteger(v.required)||v.required<=0||
    Number(m[1])!==v.owned||Number(m[2])!==v.required)fail('TRAIN_EXACT_STOCK_PAIR_REQUIRED');stock=v;
  }
 }
 if(stock&&slots.find(s=>s.slotId===reading.selectedCarriage)?.required!==stock.required)fail('TRAIN_SELECTED_QUANTITY_MISMATCH');
 return {slots,stock,destinations:destinations.filter(n=>Number.isSafeInteger(n.required))};
}
export function trainSlotTargets(reading,data,registration){
 const {profile}=registration,row=profile.rows.find(r=>r.row===reading.row&&r.layoutId===reading.layoutId);
 if(!row)return [];
 const selected=data.order.needs.find(n=>n.slotId===reading.selectedCarriage),slot=row.slots.find(s=>s.slotId===reading.selectedCarriage);
 const popup=slot&&trainSlotPopup(profile,row,slot,selected?.itemId);
 // Keep every carriage and the layout end under exact preflight comparison.
 // Group adjacent boxes to fit the existing six-region contract; tolerances
 // and numeric/check protection are unchanged, including the pixels between.
 const union=boxes=>{const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};};
 const grids=row.slots.map(s=>s.gridBox);
 grids[grids.length-1]=union([grids.at(-1),...row.layoutAnchors.map(s=>s.box)]);
 if(grids.length>4)grids.splice(0,2,union(grids.slice(0,2)));
 const verification={version:1,anchorBoxes:[profile.anchors[0],...(popup?popup.anchors:row.bareAnchors)].map(s=>s.box),
  criticalRegions:[...(popup?[{field:'stock',box:popup.field.box}]:[]),...grids.map(box=>({field:'order_grid',box}))]};
 const entries=(data.train.destinationNeeds??[]).map(n=>{
  const other=profile.rows.find(r=>r.row===n.row&&r.layoutId===n.layoutId),s=other.slots.find(s=>s.slotId===n.slotId);
  return {id:'train-row-detail:'+n.slotId,kind:'inspect_item',type:'tap',box:s.selectBox,
   trainDetail:{row:n.row,layoutId:n.layoutId,slotId:n.slotId,itemId:n.itemId,required:n.required,popupId:'train-popup:'+n.slotId,orderId:data.order.orderId,rowEntry:true},
   verification:{...verification,targetRegions:[s.selectBox],criticalRegions:[...verification.criticalRegions,{field:'destination_carriage',box:s.gridBox}]}};
 });
 if(data.train.fullDemandConfirmed!==true||data.order.disposition!=='deliver')return entries;
 const targets=data.order.needs.filter(n=>n.slotId!==reading.selectedCarriage).map(n=>{
  const s=row.slots.find(s=>s.slotId===n.slotId);
  return {id:'train-detail:'+n.slotId,kind:'inspect_item',type:'tap',box:s.selectBox,
   trainDetail:{row:row.row,layoutId:row.layoutId,slotId:n.slotId,itemId:n.itemId,popupId:'train-popup:'+n.slotId,orderId:data.order.orderId},
   verification:{...verification,targetRegions:[s.selectBox]}};
 });
 // Native final load changes the screen; its departure is a separate capability.
 if(popup&&reading.freeLoad&&selected&&Number.isSafeInteger(selected.owned)&&selected.owned>=selected.required&&data.order.needs.length>1)
  targets.unshift({id:'train-load:'+selected.slotId,kind:'load_train',type:'tap',box:popup.load.box,
   management:{purpose:'transport',verified:true,programVerified:true,currency:'NONE',itemId:selected.itemId,required:selected.required,
    owned:selected.owned,orderId:data.order.orderId,row:row.row,layoutId:row.layoutId,slotId:selected.slotId},
   verification:{...verification,targetRegions:[popup.load.box]}});
 return [...targets,...entries];
}
export function decodeTrainSlots(state,frame,reading,ocr,{registration,temporaryContext=null,now=Date.now(),validateSource}={}){
 const {slots,stock,destinations}=readTrainSlotNumbers(frame,reading,ocr),current=need(slots),loaded=ids(slots),action=state.actions?.[state.input];
 let context=null;
 if(state.input){
  const source=state.frames?.[action?.frameId];
  if(!['issued','captured'].includes(action?.status)||!['load_train','inspect_item'].includes(action.target?.kind)||
   action.target?.kind==='inspect_item'&&!action.target.trainDetail||!acceptedFacts(source)||source.review.reviewedBy!=='program-train-loading'||
   source.provider!==frame.provider||source.serial!==frame.serial||!same(source.captureTarget,frame.captureTarget)||
   frame.epoch!==action.epoch||frame.sequence<=source.sequence||(state.observationInvalidation?.sequence??-1)>=source.sequence)fail('TRAIN_OWNED_RESULT_REQUIRED');
  validateSource(source);context=source;
  if(action.target.trainDetail?.rowEntry){
   const d=action.target.trainDetail,n=slots.find(n=>n.slotId===reading.selectedCarriage);
   if(d.row!==reading.row||d.layoutId!==reading.layoutId||d.slotId!==reading.selectedCarriage||d.itemId!==n?.itemId||d.required!==n.required||
    d.popupId!==reading.popupId||d.orderId!==source.review.data.order.orderId||d.row===source.review.data.train.row)fail('TRAIN_ROW_ENTRY_RESULT_REQUIRED');
   context=null;
   if(temporaryContext&&same(state.frames[temporaryContext.id],temporaryContext)&&acceptedFacts(temporaryContext)&&
    temporaryContext.review.data.train.fullDemandConfirmed&&temporaryContext.review.data.train.layoutId===reading.layoutId&&
    temporaryContext.sequence<frame.sequence&&(state.observationInvalidation?.sequence??-1)<temporaryContext.sequence&&inputEvidenceValid(temporaryContext,now,state)){
    validateSource(temporaryContext);context=temporaryContext;
   }
  }
 }else if(temporaryContext){
  if(hasUnresolvedActions(state.actions??{}))fail('INPUT_UNRESOLVED');
  const source=state.frames?.[temporaryContext.id];
  if(source&&same(source,temporaryContext)&&acceptedFacts(source)&&source.provider===frame.provider&&source.serial===frame.serial&&
   source.sequence<frame.sequence&&source.review.data.train.fullDemandConfirmed&&source.review.data.train.row===reading.row&&
   source.review.data.train.layoutId===reading.layoutId&&(state.observationInvalidation?.sequence??-1)<source.sequence&&inputEvidenceValid(source,now,state)){
   validateSource(source);
   const old=source.review.data;
   // A settled external change ends this disposable observation context. Fully
   // visible new demand can stand on its own; hidden checked demand stays held.
   if(same(current,old.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})))&&
    same(loaded,old.train.loadedCarriages.map(s=>s.slotId).sort()))context=source;
  }
 }
 let originalNeeds=current,origin={frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,observedAt:frame.observedAt},full=true;
 let orderId=transportAbbreviation('train')+':r'+reading.row+':'+orderSignature(current)+':'+sha(origin).slice(0,16);
 if(context){
  const previous=context.review.data;
  if(previous.train.row!==reading.row||previous.train.layoutId!==reading.layoutId)fail('TRAIN_ROW_CHANGED');
  originalNeeds=previous.train.originalNeeds;origin=previous.train.origin;orderId=previous.order.orderId;
  if(!previous.train.fullDemandConfirmed||!originalNeeds?.length)fail('TRAIN_WHOLE_ORDER_POLICY_REQUIRED');
  const old=previous.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})),oldLoaded=previous.train.loadedCarriages.map(s=>s.slotId).sort();
  if(action?.target.kind==='load_train'){
   const n=previous.order.needs.find(n=>n.slotId===previous.train.selectedCarriage),m=action.target.management;
   if(previous.order.disposition!=='deliver'||!n||m?.programVerified!==true||m.currency!=='NONE'||m.orderId!==orderId||m.row!==reading.row||m.layoutId!==reading.layoutId||
    m.slotId!==n.slotId||m.itemId!==n.itemId||m.required!==n.required||m.owned!==n.owned||!Number.isSafeInteger(m.owned)||m.owned<m.required||
    !same(current,old.filter(x=>x.slotId!==n.slotId))||!same(loaded,[...oldLoaded,n.slotId].sort()))fail('TRAIN_SAME_CARRIAGE_RESULT_REQUIRED');
  }else{
   if(!same(current,old)||!same(loaded,oldLoaded))fail('TRAIN_UNTRACKED_ROW_CHANGE');
   if(action&&!action.target.trainDetail?.rowEntry){const d=action.target.trainDetail,s=slots.find(s=>s.slotId===reading.selectedCarriage);
    if(!d||d.row!==reading.row||d.layoutId!==reading.layoutId||d.slotId!==reading.selectedCarriage||d.itemId!==s?.itemId||
     d.popupId!==reading.popupId||d.orderId!==orderId||previous.train.selectedCarriage===d.slotId)fail('TRAIN_DETAIL_RESULT_REQUIRED');}
  }
 }else if(loaded.length){full=false;originalNeeds=null;origin=null;orderId=transportAbbreviation('train')+'-unbound:r'+reading.row+':'+sha(current).slice(0,32);}
 if(full&&(originalNeeds.length!==slots.length||current.some(n=>!originalNeeds.some(o=>same(o,n)))||loaded.some(id=>!originalNeeds.some(n=>n.slotId===id))))fail('TRAIN_ORIGINAL_DEMAND_CHANGED');
 const selected=slots.find(s=>s.slotId===reading.selectedCarriage);
 const data={order:{orderId,kind:'normal',transport:'train',identityMode:'product_list',signature:full?orderSignature(originalNeeds):null,
  orderConfirmed:full,needs:current.map(n=>({...n,owned:stock&&n.itemId===selected.itemId?stock.owned:null})),disposition:full?orderDisposition(originalNeeds):'hold'},
  train:{row:reading.row,layoutId:reading.layoutId,observationMode:'current_slots',selectedCarriage:reading.selectedCarriage,fullDemandConfirmed:full,
   originalNeeds,origin,loadedCarriages:loaded.map(slotId=>full?{...originalNeeds.find(n=>n.slotId===slotId),loaded:true}:{slotId,loaded:true,itemId:null,required:null}),
   destinationNeeds:destinations.map(({row,layoutId,slotId,itemId,required})=>({row,layoutId,slotId,itemId,required})),profileVersion:registration.profile.version}};
 return {review:{reviewedBy:'program-train-loading',quality:{gameVisible:true,occluded:false},actualKind:'train',actualEntityId:null,data,
  targets:state.session.management?trainSlotTargets(reading,data,registration):[]},contextFrameId:context?.id??null};
}
export function validateTrainSlotProof(frame,registration){
 const r=frame.review,p=r.proof,reading=p?.slotReading;
 if(!acceptedFacts(frame)||p.profileHash!==registration.hash||!reading?.supported||reading.observationMode!=='current_slots'||
  p.fieldsHash!==sha(p.numericFields)||p.reviewHash!==reviewFactHash(r))fail('TRAIN_LOADING_PROOF_CHANGED');
 const {slots,stock,destinations}=readTrainSlotNumbers(frame,reading,{frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,epoch:frame.epoch,observedAt:frame.observedAt,scene:'train',fields:p.numericFields});
 const data=r.data,row=registration.profile.rows.find(row=>row.row===reading.row&&row.layoutId===reading.layoutId),full=data.train.fullDemandConfirmed;
 if(!row||data.order.identityMode!=='product_list'||data.train.row!==row.row||data.train.layoutId!==row.layoutId||data.train.selectedCarriage!==reading.selectedCarriage||
  !same(row.slots.map(s=>s.slotId),slots.map(s=>s.slotId))||!same(need(slots),data.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})))||
  !same(ids(slots),data.train.loadedCarriages.map(s=>s.slotId).sort()))fail('TRAIN_LOADING_PROOF_CHANGED');
 for(const [id,loc]of Object.entries(reading.quantityLocators??{})){
  const s=row.slots.find(s=>s.slotId===id),g=registration.profile.multiplierGlyphs.find(g=>g.file===loc.file);
  if(!s||!g||loc.box.y!==s.quantityField.box.y||loc.box.width!==g.width||loc.box.height!==g.height||
   !Number.isSafeInteger(loc.box.x)||loc.box.x<s.body.box.x+20||loc.box.x>s.body.box.x+69)fail('TRAIN_LOADING_PROOF_CHANGED');
 }
 const expectedFields=row.slots.filter(s=>!slots.find(n=>n.slotId===s.slotId).loaded).map(s=>quantityField(s,slots.find(n=>n.slotId===s.slotId).itemId,reading.quantityLocators?.[s.slotId]));
 for(const n of reading.destinations??[]){
  const other=registration.profile.rows.find(r=>r.row===n.row&&r.layoutId===n.layoutId),s=other?.slots.find(s=>s.slotId===n.slotId);
  if(!s||n.row===row.row||!registration.profile.items.some(i=>i.itemId===n.itemId&&i.variants.some(v=>same(n.iconBox,{...v.region.box,x:s.body.box.x+v.offset.x,y:s.body.box.y+v.offset.y}))))fail('TRAIN_LOADING_PROOF_CHANGED');
  expectedFields.push(quantityField(s,n.itemId));
 }
 if(!same(data.train.destinationNeeds,destinations.map(({row,layoutId,slotId,itemId,required})=>({row,layoutId,slotId,itemId,required}))))fail('TRAIN_LOADING_PROOF_CHANGED');
 const selected=slots.find(s=>s.slotId===reading.selectedCarriage);
 if(selected)expectedFields.push(trainSlotPopup(registration.profile,row,row.slots.find(s=>s.slotId===selected.slotId),selected.itemId).field);
 if(!same(reading.fields,expectedFields)||slots.some(s=>!s.loaded&&!registration.profile.items.some(i=>i.itemId===s.itemId&&i.variants.some(v=>{
   const b=row.slots.find(n=>n.slotId===s.slotId).body.box;return same(s.iconBox,{...v.region.box,x:b.x+v.offset.x,y:b.y+v.offset.y});})))||
  data.order.needs.some(n=>n.owned!==(stock&&n.itemId===selected.itemId?stock.owned:null)))fail('TRAIN_LOADING_PROOF_CHANGED');
 if(full){
  const original=data.train.originalNeeds;
  if(data.order.orderConfirmed!==true||!Array.isArray(original)||original.length!==row.slots.length||!same(original.map(s=>s.slotId),row.slots.map(s=>s.slotId))||
   original.some(n=>!registration.profile.items.some(i=>i.itemId===n.itemId)||!Number.isSafeInteger(n.required)||n.required<=0)||
   slots.some(s=>!s.loaded&&!original.some(n=>same(n,need([s])[0])))||
   data.train.loadedCarriages.some(s=>!original.some(n=>n.slotId===s.slotId&&n.itemId===s.itemId&&n.required===s.required))||
   !data.train.origin?.frameId||ids(slots).length&&!p.contextFrameId||data.order.signature!==orderSignature(original)||
   data.order.disposition!==orderDisposition(original))fail('TRAIN_LOADING_PROOF_CHANGED');
 }else if(full!==false||data.order.orderConfirmed!==false||data.order.disposition!=='hold'||data.train.originalNeeds!==null||data.train.origin!==null||r.targets.some(t=>!t.trainDetail?.rowEntry))fail('TRAIN_LOADING_PROOF_CHANGED');
 if(r.targets.length&&!same(r.targets,trainSlotTargets(reading,data,registration)))fail('TRAIN_LOADING_PROOF_CHANGED');
}
