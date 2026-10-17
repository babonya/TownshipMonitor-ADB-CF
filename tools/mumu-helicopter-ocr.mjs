import {frameMetadata,validateOcr} from './mumu-perception-bridge.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// A malformed or low-confidence line may include non-text decoration. Detect
// text in the SAME complete field at two scales; never crop digits or repair text.
export async function readHelicopterNumbers(worker,frame,bytes,fields,{confirmedItems={}}={}){
  const request={scene:'helicopter',fields};
  const read=async specs=>{
    const result=await worker.analyze(frame,bytes,{scene:'helicopter',fields:specs,offline:true});
    return validateOcr(result,frameMetadata(frame),worker.health,{scene:'helicopter',fields:specs});
  };
  const base=await read(fields);
  if(base.status!=='candidate')return base;
  // Keep the complete initial stock batch. A confirmed deletion threshold
  // makes unrelated malformed-pair repair unnecessary; uncertain quantities
  // and unconfirmed same-product identities cannot establish that threshold.
  const confirmedNeeds=base.fields.filter(f=>f.kind==='stock_pair'&&f.status==='parsed_candidate'&&
    Number.isSafeInteger(f.value?.owned)&&f.value.owned>=0&&Number.isSafeInteger(f.value?.required)&&f.value.required>0)
    .map(f=>({itemId:Object.hasOwn(confirmedItems,f.slotId)?confirmedItems[f.slotId]:null,required:f.value.required}));
  if(orderDisposition(confirmedNeeds)==='delete')return base;
  const failed=fields.filter((f,i)=>f.kind==='stock_pair'&&base.fields[i].status==='unknown'&&
    ['PAIR_FORMAT_INVALID','OCR_SCORE_INSUFFICIENT'].includes(base.fields[i].reason));
  if(!failed.length)return base;
  const first=await read(failed.map(f=>({...f,scale:2,recognitionOnly:false})));
  const second=await read(failed.map(f=>({...f,scale:3,recognitionOnly:false})));
  if(first.status!=='candidate'||second.status!=='candidate')return base;
  const a=new Map(first.fields.map(f=>[f.fieldId,f])),b=new Map(second.fields.map(f=>[f.fieldId,f]));
  const merged=base.fields.map(original=>{
    const x=a.get(original.fieldId),y=b.get(original.fieldId);
    if(!x||!y)return original;
    const attempts=[original,x,y];
    if(x.status!=='parsed_candidate'||y.status!=='parsed_candidate'||!same(x.value,y.value))
      return {...original,retryEvidence:attempts,retryReason:'OCR_RETRY_UNCONFIRMED'};
    return {...x,retryEvidence:attempts,retryReason:null};
  });
  const combined={...base,fields:merged,elapsedMs:base.elapsedMs+first.elapsedMs+second.elapsedMs};
  validateOcr(combined,frameMetadata(frame),worker.health,{...request,fields:fields.map((f,i)=>
    ({...f,scale:merged[i].scale,recognitionOnly:merged[i].recognitionOnly}))});
  return combined;
}
