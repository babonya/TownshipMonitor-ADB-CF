import {sha} from './client.mjs';

// Quantity OCR belongs to the current crop; SOM remains for SALE.
export async function applyTextDecisions(v,client,meta){
  if(v.scene==='helicopter'&&!v.refreshing&&!v.minigame?.detected&&Array.isArray(v.orderSlots)){
    v.shortageChecks=[];v.missing=[];
    for(const slot of v.orderSlots){
      const answer={choice:quantityChoice(slot)};
      v.shortageChecks.push({id:slot.id,productHash:slot.hash,cropHash:slot.amount.hash,orderHash:v.orderHash,readingHash:sha(slot.amount.reading??null),answer});
      if(answer.choice==='yes')v.missing.push(slot);
    }
  }
  if(v.marketRefresh){
    const r=v.marketRefresh;
    v.marketRefresh={...r,sourceFrameId:meta.frameId,evidenceHash:meta.evidenceHash,observedAt:meta.observedAt};
  }
  if(v.marketScanCoverage?.saleChecks){
    const coverage=v.marketScanCoverage;
    for(const check of coverage.saleChecks)check.answer=await client.saleText(check.image);
    coverage.complete=coverage.geometryComplete===true&&coverage.saleChecks.every(c=>c.answer?.choice==='yes');
  }
}

function quantityChoice(slot){
  const reading=slot.amount?.reading,value=reading?.value;
  if(!reading||reading.quantityHash!==slot.amount.hash||reading.productHash!==slot.hash)return 'uncertain';
  if(reading.status==='empty'&&value===null)return 'no';
  if(reading.status!=='parsed_candidate'||!Number.isSafeInteger(value?.owned)||value.owned<0||
    !Number.isSafeInteger(value?.required)||value.required<=0||!Array.isArray(reading.ocrScores)||
    reading.ocrScores.length!==1||!Number.isFinite(reading.ocrScores[0])||reading.ocrScores[0]<.9)return 'uncertain';
  return value.owned<value.required?'yes':'no';
}

export function orderShortagesKnown(v){
  const slots=v.orderSlots,checks=v.shortageChecks;
  return Array.isArray(slots)&&slots.length>0&&Array.isArray(checks)&&checks.length===slots.length&&
    slots.some(s=>s.amount?.reading?.status==='parsed_candidate')&&
    slots.every((s,n)=>s.amount?.hash&&checks[n].id===s.id&&checks[n].productHash===s.hash&&
      checks[n].cropHash===s.amount.hash&&checks[n].orderHash===v.orderHash&&
      checks[n].readingHash===sha(s.amount.reading??null)&&checks[n].answer?.choice===quantityChoice(s)&&
      ['yes','no'].includes(checks[n].answer?.choice))&&
    Array.isArray(v.missing)&&sha(v.missing)===sha(slots.filter((s,n)=>checks[n].answer.choice==='yes'));
}

// Current requested quantity, never owned stock or the missing difference.
export function orderQuantityLimitReached(v){
  return v.provider==='android_adb'&&v.scene==='helicopter'&&!v.refreshing&&orderShortagesKnown(v)&&
    v.orderSlots.some(s=>s.amount.reading.status==='parsed_candidate'&&s.amount.reading.value.required>=8);
}

