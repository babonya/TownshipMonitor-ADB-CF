import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng,regionDigest,validateBox} from './adb.mjs';
import {resolvePercentageProfile} from './percentage-profile.mjs';
import {registeredMarketStatic} from './mumu-market-static.mjs';
import {boundNavigationOriginal} from './mumu-navigation-locator.mjs';
import {acceptedFacts,reviewFactHash,actionEffect} from './mumu-evidence.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {validateMarketProof} from './mumu-market-proof.mjs';
export const BARN_READER='program-barn-sale';
export const barnHash=v=>digest(Buffer.from(JSON.stringify(v)));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=message=>{throw Error(message);};
const shift=(b,p)=>({...b,x:b.x+p.x,y:b.y+p.y});
const inside=(a,b)=>a&&a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;
function sourceCropEqual(source,crop,box){
 for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
  const si=((y+box.y)*source.width+x+box.x)*source.channels,ci=(y*crop.width+x)*crop.channels;
  for(let c=0;c<3;c++)if(source.pixels[si+c]!==crop.pixels[ci+c])return false;
  if(source.channels===4&&source.pixels[si+3]!==255)return false;
 }return true;
}
const file=fileURLToPath(new URL('../reference/barn-sale/profile.json',import.meta.url));
let profileCache=null;
export function barnSaleProfile(){
 const bytes=readFileSync(file),profile=resolvePercentageProfile(JSON.parse(bytes)),assets=new Map(),raw=new Map(),decoded=new Map();
 const collect=v=>{if(Array.isArray(v))return v.forEach(collect);if(!v||typeof v!=='object')return;
  if(v.file){if(v.file!==v.file.split(/[\\/]/).at(-1))fail('BARN_ASSET_CHANGED');if(!raw.has(v.file))raw.set(v.file,readFileSync(join(dirname(file),v.file)));}
  Object.values(v).forEach(collect);};collect(profile);
 const fingerprint=barnHash([digest(bytes),...Array.from(raw,([name,b])=>[name,digest(b)])]);
 if(profileCache?.fingerprint===fingerprint)return profileCache.value;
 const decode=name=>{if(!decoded.has(name))decoded.set(name,decodePng(raw.get(name)));return decoded.get(name);};
 const walk=v=>{if(Array.isArray(v))return v.forEach(walk);if(!v||typeof v!=='object')return;
  if(v.file&&v.source){if(v.file!==v.file.split(/[\\/]/).at(-1)||v.source.file!==v.source.file.split(/[\\/]/).at(-1))fail('BARN_ASSET_CHANGED');
   const b=raw.get(v.file),s=raw.get(v.source.file),im=decode(v.source.file),crop=decode(v.file);
   if(digest(b)!==v.sha256||digest(s)!==v.source.sha256||im.width!==v.source.dimensions.width||im.height!==v.source.dimensions.height||
    crop.width!==v.source.cropBox.width||crop.height!==v.source.cropBox.height||!sourceCropEqual(im,crop,v.source.cropBox))fail('BARN_ASSET_CHANGED');assets.set(v.file,crop);}
  Object.values(v).forEach(walk);};walk(profile);
 if(profile.schema!==1||!profile.translationOnly||!profile.sourceResultRegistered)fail('BARN_SOURCE_RESULT_REQUIRED');
 const value={profile,hash:digest(bytes),assets};profileCache={fingerprint,value};return value;
}
export function barnFields(reading){
 return [{fieldId:'barn-capacity',kind:'capacity',box:reading.capacityBox},
  ...reading.rows.filter(r=>r.identityConfirmed||reading.selected).map(r=>({fieldId:'barn-owned:'+r.index,kind:'quantity',box:r.quantityBox})),
  ...reading.selected?[{fieldId:'barn-default',kind:'quantity',box:reading.selected.quantityBox}]:[]]
  .map(f=>({...f,scale:3,minimumScore:.95,recognitionOnly:true}));
}
export function decodeBarnReading(frame,reading,ocr,reg=barnSaleProfile()){
 if(!reading?.supported||reading.profileHash!==reg.hash)fail('BARN_SOURCE_REQUIRED');
 const im=boundNavigationOriginal(frame),p=reg.profile,panel=reading.panelBox;
 validateBox(panel,frame.width,frame.height);
 if(panel.width!==p.panel.dimensions.width||panel.height!==p.panel.dimensions.height)fail('BARN_GEOMETRY_CHANGED');
 const matches=(spec,b)=>{
  const t=reg.assets.get(spec.file);validateBox(b,im.width,im.height);
  return t.width===b.width&&t.height===b.height&&sourceCropEqual(im,t,b)||registeredMarketStatic(im,{...spec,box:b},reg);
 };
 for(const [key,out] of [['title','titleBox'],['close','closeBox'],['capacity','capacityBox'],['grid','gridBox']])
  if(!same(reading[out],shift(p.panel[key],panel)))fail('BARN_GEOMETRY_CHANGED');
 for(const key of ['title','close','bottom',...reading.selected?[]:['plainStrip']])
  if(!matches(p.anchors[key],shift(p.panel[key],panel)))fail('BARN_ANCHOR_CHANGED');
 if(!Array.isArray(reading.tabs)||reading.tabs.length!==p.tabs.length)fail('BARN_TAB_REQUIRED');
 for(const [i,tab] of reading.tabs.entries()){
  const spec=p.tabs[i];if(tab.id!==spec.id||!same(tab.box,shift(spec.box,panel))||!['active','inactive','unknown'].includes(tab.state))fail('BARN_TAB_CHANGED');
  if(tab.state!=='unknown'&&(!inside(tab.matchBox,shift(spec.searchBox,panel))||!matches(spec[tab.state],tab.matchBox)))fail('BARN_TAB_CHANGED');
 }
 const active=reading.tabs.filter(t=>t.state==='active');
 if(active.length>1||reading.activeTab!== (active.length===1?active[0].id:matches(p.anchors.allTab,shift(p.panel.allTab,panel))?'all':null))fail('BARN_TAB_CHANGED');
 if(!reading.selected&&!reading.activeTab)fail('BARN_TAB_REQUIRED');
 if(reading.rows.length!==p.panel.rows.length)fail('BARN_ROWS_CHANGED');
 for(const [i,r] of reading.rows.entries()){
  if(r.index!==i||!same(r.iconBox,shift(p.panel.rows[i].iconBox,panel))||!same(r.quantityBox,shift(p.panel.rows[i].quantityBox,panel)))fail('BARN_ROWS_CHANGED');
  if(r.itemId){const item=p.products.find(x=>x.itemId===r.itemId);
   if(!item||r.category!==item.category||!r.identityConfirmed||!inside(r.matchBox,r.iconBox)||!matches(item.template,r.matchBox))fail('BARN_PRODUCT_CHANGED');}
 }
 if(reading.selected){const s=reading.selected,c=p.selection,origin=s.popupBox;
  if(s.itemId!=='donut'||s.category!=='factory_product'||!same(origin,shift(c.popup,origin)))fail('BARN_SELECTION_CHANGED');
  for(const [key,out] of [['title','titleBox'],['quantity','quantityBox'],['sell','sellBox']])if(!same(s[out],shift(c[key],origin)))fail('BARN_SELECTION_CHANGED');
  for(const [name,key] of [['titleTemplate','title'],['minusTemplate','minus'],['plusTemplate','plus'],['sellTemplate','sellLabel'],['coinTemplate','coin']])
   if(!matches(c[name],shift(c[key],origin)))fail('BARN_SELECTION_CHANGED');
 }
 const fields=barnFields(reading);
 if(!ocr||ocr.frameId!==frame.id||ocr.evidenceHash!==frame.evidenceHash||ocr.sequence!==frame.sequence||ocr.epoch!==frame.epoch||
  ocr.observedAt!==frame.observedAt||ocr.scene!=='barn'||ocr.fields?.length!==fields.length)fail('BARN_OCR_CONTEXT_CHANGED');
 const values=new Map();
 for(const [i,expected] of fields.entries()){
  const f=ocr.fields[i];if(f.fieldId!==expected.fieldId||f.kind!==expected.kind||!same(f.box,expected.box))fail('BARN_OCR_FIELD_CHANGED');
  const text=(f.rawText??'').normalize('NFKC').replace(/\s/g,'');let v=null;
  if(f.status==='parsed_candidate'&&f.ocrScores?.length&&f.ocrScores.every(n=>Number.isFinite(n)&&n>=.95&&n<=1)){
   if(f.kind==='quantity'&&/^\d{1,6}$/.test(text)&&Number(text)===f.value)v=f.value;
   if(f.kind==='capacity'&&/^\d{1,6}\/\d{1,6}$/.test(text)){const [used,total]=text.split('/').map(Number);
    if(total>0&&used<=total&&f.value?.used===used&&f.value.total===total&&f.value.free===total-used)v={used,total,free:total-used};}
  }values.set(f.fieldId,v);
 }
 return {...reading,capacity:values.get('barn-capacity'),rows:reading.rows.map(r=>({...r,owned:values.get('barn-owned:'+r.index)??null})),
  selected:reading.selected?{...reading.selected,defaultQuantity:values.get('barn-default')}:null};
}
export function barnPurchase(state,needs,now){
 const e=state.barnRecovery?.active,origin=e?.lastEvidence;if(!origin||!needs.needs[origin.itemId]?.quantity)return null;
 let f=state.frames[origin.sourceFrameId];if(!f||f.evidenceHash!==origin.sourceHash||!inputEvidenceValid(f,now,state)||
  f.sequence<=(state.orderDemandStartup?.cutoffSequence??-1))return null;
 const result=f.review?.data?.actionResult;
 if(result){const a=state.actions[result.actionId];if(a?.status!=='verified'||a.resultFrameId!==f.id||result.rejectionReason!=='MARKET_BARN_FULL')return null;f=state.frames[a.frameId];}
 if(!f||!acceptedFacts(f)||f.review.reviewedBy!=='program-market'||f.review.proof?.role!=='source'||!inputEvidenceValid(f,now,state))return null;validateMarketProof(f);
 if(Object.values(state.actions??{}).some(a=>a.management&&['issued','captured','verified','unknown'].includes(a.status)&&
  (state.frames[a.frameId]?.sequence??Infinity)>f.sequence))return null;
 const d=f.review.data,row=d.rows.find(r=>r.itemId===origin.itemId&&r.quantity===origin.quantity&&
  r.slotId===(d.marketDecision?.blockedSlotId??d.marketDecision?.slotId));
 if(!row||row.identity?.status!=='matched'||barnHash(d.currentNeeds?.needs)!==barnHash(needs.needs))return null;
 return {itemId:row.itemId,quantity:row.quantity,sourceFrameId:f.id,sourceHash:f.evidenceHash,episode:e.number};
}
export function selectedBarnSource(state,frame,barn){
 const a=Object.values(state.actions).find(a=>a.status==='verified'&&a.target?.barnNative?.role==='inspect'&&
  a.nextVisit?.visitId===frame.sceneId&&state.frames[a.resultFrameId]?.review?.data?.barn?.selected?.itemId===barn.selected?.itemId);
 if(!a)return null;
 if(!validBarnTarget(state.frames[a.frameId],a.target))return null;
 const result=state.frames[a.resultFrameId],proof=a.resultProof;
 if(!proof||proof.frameId!==result.id||proof.evidenceHash!==result.evidenceHash||proof.review?.proof?.reviewHash!==reviewFactHash(proof.review)||
  proof.navigation?.confirmed!==true||proof.navigation.actionId!==a.id)return null;
 validateBarnProof({...result,review:proof.review});
 const source=state.frames[a.frameId],opening=state.frames[a.resultFrameId]?.review?.data?.barn,
  row=source?.review?.data?.barn?.rows.find(r=>r.index===a.target.barnNative.index);
 if(!row||row.itemId!==barn.selected?.itemId||opening.activeTab!==barn.activeTab||source.review.data.barn.activeTab!==barn.activeTab||opening.selected.defaultQuantity!==barn.selected.defaultQuantity||
  opening.capacity?.used!==barn.capacity?.used||opening.capacity?.total!==barn.capacity?.total||barn.rows[row.index]?.owned!==row.owned)return null;
 return {actionId:a.id,row,defaultQuantity:opening.selected.defaultQuantity};
}
export function barnTargets(frame,data,reg=barnSaleProfile()){
 const b=data.barn,d=data.barnDecision;if(!d||d.kind==='hold')return [];
 let kind,box,critical=[];
 if(d.kind==='tab'){kind='select_barn_category';box=b.tabs.find(t=>t.id===d.tabId)?.box;}
 else if(d.kind==='inspect'){kind='inspect_item';box=b.rows[d.index]?.iconBox;critical=[{field:'stock',box:b.rows[d.index]?.quantityBox}];}
 else if(d.kind==='sell'){kind='barn_sell';box=b.selected?.sellBox;critical=[{field:'quantity',box:b.selected?.quantityBox},{field:'stock',box:b.rows[d.index]?.quantityBox},{field:'capacity',box:b.capacityBox}];}
 else if(d.kind==='dismiss'){kind='close_panel';box=b.titleBox;critical=[{field:'selection',box:b.selected?.titleBox}];}
 else if(d.kind==='leave'){kind='close_panel';box=b.closeBox;}
 else fail('BARN_DECISION_CHANGED');
 const tag={schema:1,role:d.kind,profileHash:reg.hash,needHash:data.currentNeeds.hash,episode:data.episode,index:d.index??null,tabId:d.tabId??b.activeTab};
 return [{id:'barn-'+d.kind,kind,type:'tap',box,barnNative:tag,
  ...kind==='barn_sell'?{management:{purpose:'transport',verified:true,currency:'NONE',itemId:b.selected.itemId,category:b.selected.category,
   quantity:b.selected.defaultQuantity,spaceNeeded:data.purchase.quantity-b.capacity.free,surplus:d.surplus,programVerified:true,barnTab:b.activeTab}}:{},
  // Closing is pure navigation: the current barn title and X must remain
  // exact, while an already verified sale's grid animation may continue.
  // Inspect/sell/dismiss retain their full capacity, grid and tab preflight.
  verification:{version:1,maxChangedRatio:0,channelTolerance:0,anchorBoxes:d.kind==='leave'?[b.titleBox]:[b.titleBox,b.capacityBox],targetRegions:[box],
   criticalRegions:d.kind==='leave'?[]:[...critical,{field:'barn_grid',box:b.gridBox},...b.tabs.filter(t=>t.state==='active').map(t=>({field:'active_tab',box:t.matchBox}))]}}];
}
export function validateBarnProof(frame,reg=null){
 if(frame.review?.reviewedBy!==BARN_READER)return;
 reg??=barnSaleProfile();
 const r=frame.review,p=r.proof,d=r.data;
 if(!acceptedFacts(frame)||p?.schema!=='program-barn-sale-1'||p.profileHash!==reg.hash||p.reviewHash!==reviewFactHash(r)||
  p.frameId!==frame.id||p.evidenceHash!==frame.evidenceHash||!['source','result'].includes(p.role)||d.order!==undefined||
  !['barn','town'].includes(r.actualKind)||r.actualEntityId!==null)fail('BARN_PROOF_CHANGED');
 if(r.actualKind==='barn'&&!same(decodeBarnReading(frame,d.reading,d.ocr,reg),d.barn))fail('BARN_FACTS_CHANGED');
 if(p.role==='source'&&(r.actualKind!=='barn'||!same(r.targets,barnTargets(frame,d,reg))))fail('BARN_TARGET_CHANGED');
 if(p.role==='result'&&(r.targets.length||d.actionResult?.actionId!==p.inputId||d.actionResult?.confirmed!==true))fail('BARN_RESULT_CHANGED');
}
export function validBarnTarget(frame,target){
 if(frame?.review?.reviewedBy!==BARN_READER||target?.barnNative?.schema!==1)return false;
 const reg=barnSaleProfile();validateBarnProof(frame,reg);
 return frame.provider==='google_play_windows'&&frame.width===reg.profile.executionGeometry.width&&frame.height===reg.profile.executionGeometry.height&&
  frame.review.proof.role==='source'&&frame.review.targets.some(t=>same(t,target));
}
export function validateBarnInput(state,frame,target,now,{pending=false}={}){
 if(!target?.barnNative)return;
 if(!validBarnTarget(frame,target)||!inputEvidenceValid(frame,now,state))fail('BARN_SOURCE_RESULT_REQUIRED');
 const d=frame.review.data,role=target.barnNative.role,needs=currentScreenNeeds(state,{now});
 if(!pending&&(state.latestFrameId!==frame.id||state.scene.epoch!==frame.epoch))fail('CURRENT_BARN_FRAME_REQUIRED');
 if(['dismiss','leave'].includes(role))return;
 if(!['crops','products'].includes(target.barnNative.tabId)||role!=='tab'&&d.barn.activeTab!==target.barnNative.tabId)fail('BARN_ALLOWED_TAB_REQUIRED');
 if(role==='tab'&&(d.barn.selected||!d.barn.tabs.some(t=>t.id===target.barnNative.tabId&&t.state==='inactive')))fail('BARN_TAB_CHANGED');
 if(target.barnNative.needHash!==needs.hash||d.episode!==state.barnRecovery?.active?.number||needs.held.length||needs.feasible.length||
  !same(barnPurchase(state,needs,now),d.purchase)||!d.barn.capacity||d.barn.capacity.free>=d.purchase.quantity)fail('BARN_CURRENT_NEED_REQUIRED');
 if(role==='tab')return;
 const reserves=needs.orders.flatMap(o=>o.needs).filter(n=>n.itemId===(d.barn.selected?.itemId??d.barn.rows[d.barnDecision.index].itemId)).reduce((n,r)=>n+r.required,0);
 if(role==='inspect'&&d.barn.rows[d.barnDecision.index].owned<=reserves)fail('BARN_SALE_PROTECTED');
 if(role==='sell'){
  const selected=selectedBarnSource(state,frame,d.barn),m=target.management;
  if(!selected||!Number.isSafeInteger(m.quantity)||m.quantity<1||selected.row.owned-reserves<m.quantity||m.surplus!==selected.row.owned-reserves||
   state.barnRecovery.active.pendingSale&&(!pending||state.barnRecovery.active.pendingSale.actionId!==state.input))fail('BARN_SALE_PROTECTED');
 }
}
