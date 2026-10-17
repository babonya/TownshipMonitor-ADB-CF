import {registeredMarketStatic} from './mumu-market-static.mjs';
import {locateNavigationVariants} from './mumu-navigation-locator.mjs';
// Disposable, current-screen space evidence. No stock ledger or balance read.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {regionDigest,digest,decodePng} from './adb.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {deliveryScopeCutoff} from './mumu-delivery-scope.mjs';
import {compareWindowsGeometry} from './windows-device.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const capacityRoles=new Set(['capacity_entry','capacity_close']);
export function validateCapacityRegistration(profile,assets,directory){
  for(const layout of profile.layouts){
    const c=layout.capacityObservation;if(!c)continue;
    if(c.schema!==1||!same(c.dimensions,layout.dimensions)||c.anchors?.length!==2||
      c.barnEntryAlternates!==undefined&&!Array.isArray(c.barnEntryAlternates))throw Error('MARKET_CAPACITY_REGISTRATION_CHANGED');
    for(const spec of [c.barnEntry,...c.barnEntryAlternates??[],...c.anchors,c.close,...(layout.townNavigation?.marketAlternates??[]).filter(s=>s.source?.file)]){
      const source=spec.source;
      if(!source||source.file!==source.file.split(/[\\/]/).at(-1)||!same(source.dimensions,c.dimensions)||!same(source.cropBox,spec.box))throw Error('MARKET_CAPACITY_SOURCE_CHANGED');
      const raw=readFileSync(join(directory,source.file)),original=decodePng(raw),crop=assets.get(spec.file);
      if(digest(raw)!==source.sha256||original.width!==c.dimensions.width||original.height!==c.dimensions.height||
        !crop||crop.width!==spec.box.width||crop.height!==spec.box.height||regionDigest(original,spec.box)!==regionDigest(crop))throw Error('MARKET_CAPACITY_SOURCE_CHANGED');
    }
  }
}
export function capacityStatic(image,spec,reg){
  return registeredMarketStatic(image,spec,reg);
}
export function locateCapacityEntry(image,capacity,reg){
  if(!image||image.width!==capacity?.dimensions?.width||image.height!==capacity?.dimensions?.height)return null;
  return locateNavigationVariants(image,[capacity.barnEntry,...capacity.barnEntryAlternates??[]],reg.assets,
    (current,spec)=>capacityStatic(current,spec,reg))?.box??null;
}
export function readMarketCapacityPanel(image,reg){
  const matches=reg.profile.layouts.filter(l=>l.dimensions.width===image.width&&l.dimensions.height===image.height&&
    l.capacityObservation?.schema===1&&l.capacityObservation.anchors.every(a=>capacityStatic(image,a,reg))&&capacityStatic(image,l.capacityObservation.close,reg));
  return matches.length===1?{layoutId:matches[0].id,capacityBox:matches[0].capacityObservation.capacityBox}:null;
}
export function decodeMarketCapacity(frame,ocr,box){
  if(!ocr||ocr.frameId!==frame.id||ocr.evidenceHash!==frame.evidenceHash||ocr.epoch!==frame.epoch||ocr.sequence!==frame.sequence||
    ocr.observedAt!==frame.observedAt||ocr.scene!=='barn'||ocr.fields?.length!==1)return null;
  const f=ocr.fields[0],text=/^(\d{1,6})\/(\d{1,6})$/.exec((f.rawText??'').normalize('NFKC').replace(/\s+/g,''));
  if(f.fieldId!=='market-capacity'||f.kind!=='capacity'||!same(f.box,box)||f.status!=='parsed_candidate'||!text||
    !f.ocrScores?.length||f.ocrScores.some(s=>!Number.isFinite(s)||s<.95||s>1))return null;
  const used=Number(text[1]),total=Number(text[2]),free=Math.max(0,total-used);
  if(total<1||used>total||f.value?.used!==used||f.value.total!==total||f.value.free!==free)return null;
  return {used,total,free,frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,ocr};
}
const changesSpace=new Set(['buy_market','buy_dealer','barn_sell','send_helicopter','load_train','load_airport','collect_product','claim_train_cargo','claim_popup_reward','claim_daily_bonus','claim_mayors_cup_reward']);
export function currentMarketCapacity(state,frame,needHash,reg,now){
  const cutoff=Math.max(state.observationInvalidation?.sequence??-1,state.orderDemandStartup?.cutoffSequence??-1,deliveryScopeCutoff(state));
  for(const f of Object.values(state.frames??{}).sort((a,b)=>b.sequence-a.sequence)){
    const r=f.review,c=r?.data?.marketCapacity;
    if(f.sequence<=cutoff||!c||!acceptedFacts(f)||r.reviewedBy!=='program-market'||r.actualKind!=='barn'||
      !['source','result'].includes(r.proof.role)||r.proof.profileHash!==reg.hash||r.data.currentNeeds?.hash!==needHash||
      f.provider!==frame.provider||f.serial!==frame.serial||f.width!==frame.width||f.height!==frame.height||!inputEvidenceValid(f,now,state)||
      c.frameId!==f.id||c.evidenceHash!==f.evidenceHash||c.sequence!==f.sequence)continue;
    try{compareWindowsGeometry(f,frame);}catch{continue;}
    const layout=reg.profile.layouts.find(l=>l.id===r.data.market?.layoutId);
    if(!layout?.capacityObservation||!same(decodeMarketCapacity(f,c.ocr,layout.capacityObservation.capacityBox),c))continue;
    // Any attempted space-changing action invalidates this observation. A new
    // visit rereads capacity rather than subtracting historical receipts.
    if(Object.values(state.actions??{}).some(a=>(changesSpace.has(a.target?.kind)||a.management||a.target?.management)&&['issued','captured','verified','unknown'].includes(a.status)&&
      (state.frames[a.frameId]?.sequence??Infinity)>=f.sequence))continue;
    return c;
  }
  return null;
}
export function capacitySufficient(capacity,quantity){
  return !!capacity&&Number.isSafeInteger(capacity.free)&&capacity.free>=0&&Number.isSafeInteger(quantity)&&quantity>0&&capacity.free>=quantity;
}
