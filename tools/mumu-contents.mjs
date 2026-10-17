// Explicit on-demand composition of two workers. Normal 1 Hz matching has no OCR.
import {performance} from 'node:perf_hooks';
import {frameMetadata,validateOcr,validatePerception} from './mumu-perception-bridge.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';

export async function readContents(frame,bytes,{matcher,ocr,layoutId,offline=false,clock=Date.now}={}){
  if(!matcher||!ocr||!layoutId)throw Error('CONTENTS_WORKERS_REQUIRED');
  const started=performance.now(),matched=await matcher.analyze(frame,bytes,{layoutId,offline});
  validatePerception(matched,frameMetadata(frame),matcher.health,{layoutId});
  const result={schema:1,frameId:matched.frameId,epoch:matched.epoch,sequence:matched.sequence,evidenceHash:matched.evidenceHash,
    observedAt:matched.observedAt,dimensions:matched.dimensions,layoutId,layoutSetHash:matched.layoutSetHash,
    registryHash:matched.registryHash,templateSetVersion:matched.templateSetVersion,scene:matched.scene,
    status:matched.status,reason:matched.reason,rows:[],ocrRequests:0,ocrRequested:false,
    coverage:'configured_slots_only',totalScreenCoverageVerified:false,configuredSlotsReadComplete:false,
    valueState:offline?'historical':'unreviewed',requiresGptReview:true,executionAllowed:false,matchingElapsedMs:matched.elapsedMs};
  if(matched.status!=='candidate')return {...result,elapsedMs:performance.now()-started};
  if(matched.scene.kind==='market')result.marketPosition={visitId:frame.sceneId??null,epoch:matched.epoch,
    frameId:matched.frameId,evidenceHash:matched.evidenceHash,stableAcrossReopen:false};
  if(new Set(matched.slots.map(s=>s.slotId)).size!==matched.slots.length)throw Error('SLOT_ID_DUPLICATE');
  const fields=matched.slots.filter(s=>s.status==='matched_candidate'&&s.itemId).flatMap(s=>[
    ...(s.quantityBox?[{fieldId:s.slotId+'.quantity',slotId:s.slotId,itemId:s.itemId,kind:s.quantityKind,box:s.quantityBox,scale:3,minimumScore:.85,recognitionOnly:true}]:[]),
    ...(s.priceBox?[{fieldId:s.slotId+'.price',slotId:s.slotId,itemId:s.itemId,kind:'price_number',box:s.priceBox,scale:3,minimumScore:.85,recognitionOnly:true}]:[])]);
  const values=new Map(),ocrResults=[];
  // The recognised scene is a program candidate bound to this same exact PNG.
  // It is not written into the runtime or presented as a completed GPT review.
  const ocrFrame={...frameMetadata(frame),expectedKind:matched.scene.kind};
  for(let offset=0;offset<fields.length;offset+=16){
    const batch=fields.slice(offset,offset+16),request={fields:batch,scene:matched.scene.kind};
    const output=await ocr.analyze(ocrFrame,bytes,{...request,offline});
    validateOcr(output,ocrFrame,ocr.health,request);ocrResults.push(output);result.ocrRequests++;
    if(output.status==='candidate')for(const field of output.fields)values.set(field.fieldId,field);
  }
  result.ocrRequested=result.ocrRequests>0;
  result.rows=matched.slots.map(slot=>{
    const field=values.get(slot.slotId+'.quantity'),priceField=values.get(slot.slotId+'.price');
    const known=slot.status==='matched_candidate'&&field?.status==='parsed_candidate'&&Number.isSafeInteger(field.value)&&field.value>=0;
    const price=priceField?.status==='parsed_candidate'&&Number.isSafeInteger(priceField.value?.amount)?priceField.value.amount:null;
    const offerKnown=matched.scene.kind!=='market'||known&&price>0&&slot.currency==='COIN';
    return {...slot,quantity:known?field.value:null,price,currency:slot.currency??null,offerStatus:matched.scene.kind==='market'?(offerKnown?'coin_offer_candidate':'hold'):null,
      status:known?'row_candidate':'hold',identityConfirmed:false,
      reason:known?null:slot.reason??field?.reason??(slot.quantityBox?'QUANTITY_UNREAD':'QUANTITY_CLIPPED'),rawQuantity:field?.rawText??null,ocrScores:field?.ocrScores??[],
      binding:{frameId:result.frameId,evidenceHash:result.evidenceHash,layoutSetHash:result.layoutSetHash,slotId:slot.slotId}};
  });
  result.ocrElapsedMs=ocrResults.reduce((sum,r)=>sum+r.elapsedMs,0);result.elapsedMs=performance.now()-started;
  result.configuredSlotsReadComplete=result.rows.length>0&&result.rows.every(r=>r.status==='row_candidate');
  if(!offline&&!inputEvidenceValid(frame,clock()))Object.assign(result,{status:'stale',valueState:'unusable',reason:'CONTENTS_OUTLIVED_FRAME'});
  return result;
}
