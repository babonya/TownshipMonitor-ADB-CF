import {BARN_READER,validBarnTarget,validateBarnProof,selectedBarnSource} from './mumu-barn-sale-proof.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {compareWindowsGeometry} from './windows-device.mjs';
import {readMarketTown} from './mumu-market-proof.mjs';
import {boundNavigationOriginal} from './mumu-navigation-locator.mjs';
import {postInputDelayMs} from './mumu-timing.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const positive=n=>Number.isSafeInteger(n)&&n>0;
export function barnSaleResult(state,action,frame){
 if(!action?.target?.barnNative)return null;
 const source=state.frames[action.frameId],role=action.target.barnNative.role,r=frame.review,d=r?.data;
 if(!source||!['issued','captured'].includes(action.status)||frame.provider!==source.provider||frame.serial!==source.serial||!validBarnTarget(source,action.target)||!acceptedFacts(frame)||r.reviewedBy!==BARN_READER||r.proof.role!=='result'||
  r.proof.inputId!==action.id||frame.sceneId!==action.nextVisit?.visitId||frame.epoch!==action.epoch||frame.sequence<=source.sequence||
  !Number.isFinite(Date.parse(frame.captureStartedAt))||!Number.isFinite(Date.parse(action.issuedAt))||Date.parse(frame.captureStartedAt)<Date.parse(action.issuedAt)+postInputDelayMs(action)||action.deviceReceipt?.commandIssued!==true)return null;
 try{compareWindowsGeometry(source,frame);validateBarnProof(frame);}catch{return null;}
 const before=source.review.data.barn,after=d.barn;
 const effect={actionId:action.id,frameId:frame.id,confirmed:true,effect:'barn_'+role+'_confirmed'};
 if(role==='leave')return r.actualKind==='town'&&readMarketTown(boundNavigationOriginal(frame)).supported?effect:null;
 if(!before?.capacity||!after?.capacity||before.capacity.total!==after.capacity.total)return null;
 if(role==='tab')return !after.selected&&after.activeTab===action.target.barnNative.tabId&&['crops','products'].includes(after.activeTab)&&same(before.capacity,after.capacity)?effect:null;
 if(after.activeTab!==before.activeTab)return null;
 if(['inspect','sell'].includes(role)&&!['crops','products'].includes(after.activeTab))return null;
 if(role==='inspect'){
  const row=before.rows[action.target.barnNative.index];
  return after.selected?.itemId===row?.itemId&&positive(after.selected.defaultQuantity)&&after.selected.defaultQuantity<=row.owned&&
   after.rows[row.index]?.owned===row.owned&&same(before.capacity,after.capacity)?effect:null;
 }
 if(role==='dismiss'){
  const original=selectedBarnSource(state,source,before),matches=after.rows.filter(r=>r.itemId===before.selected?.itemId);
  return !after.selected&&original&&matches.length===1&&matches[0].owned===original.row.owned&&same(before.capacity,after.capacity)?effect:null;
 }
 if(role==='sell'){
  const original=selectedBarnSource(state,source,before),m=action.target.management,matches=after.rows.filter(r=>r.itemId===m.itemId);
  if(after.selected||!original||matches.length!==1||original.row.owned-matches[0].owned!==m.quantity||before.capacity.used-after.capacity.used!==m.quantity)return null;
  return {...effect,itemId:m.itemId,quantity:m.quantity,beforeOwned:original.row.owned,afterOwned:matches[0].owned,
   beforeUsed:before.capacity.used,afterUsed:after.capacity.used,total:after.capacity.total,currentOwnedRecheckRequired:true};
 }
 return null;
}
