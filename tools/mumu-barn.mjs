// Information-only barn observations; no selling, upgrading, or inventory mutation.
import {evidenceWindow} from './mumu-freshness.mjs';
const fail=code=>{throw Error(code);};
const integer=n=>Number.isSafeInteger(n) && n>=0;
const id=s=>typeof s==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(s) && !['constructor','prototype','__proto__'].includes(s);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validItem=i=>i && integer(i.index) && (i.itemId===null || id(i.itemId)) && (i.quantity===null || integer(i.quantity)) &&
  (i.label===undefined || i.label===null || typeof i.label==='string');
const itemIdentity=i=>({index:i.index,itemId:i.itemId,quantity:i.quantity});

export function barnEvidenceFresh(barn,{now=Date.now(),maxAgeMs=300000}={}) {
  if(!Number.isFinite(now) || !integer(maxAgeMs))fail('FRESHNESS_INVALID');
  return !!barn && Array.isArray(barn.pages) && barn.pages.length>0 && barn.pages.length===barn.expectedPages &&
    barn.invalidated!==true&&barn.pages.every(p=>p.snapshotId===barn.snapshotId&&evidenceWindow(p,{now,maxAgeMs}).valid);
}

export function barnQuantity(barn,itemId) {
  if(!id(itemId))fail('BARN_ITEM_INVALID');
  if(Object.hasOwn(barn.inventory??{},itemId))return barn.inventory[itemId];
  // Absence proves zero only after every item and quantity in the unfiltered inventory is read.
  return barn.coverage==='complete' && barn.readComplete?0:null;
}

export function barnCoverage(state,{snapshotId,visitIds,now=Date.now(),maxAgeMs=300000,eventTracked=false}={}) {
  if(!id(snapshotId) || !Array.isArray(visitIds) || new Set(visitIds).size!==visitIds.length || !visitIds.every(id))fail('BARN_SURVEY_INVALID');
  if(!Number.isFinite(now) || !integer(maxAgeMs))fail('FRESHNESS_INVALID');
  const reasons=[],pages=[],items=new Map(),conflicted=new Set();let previous=null;
  for(const visitId of visitIds) {
    const frame=Object.values(state.frames).filter(f=>f.sceneId===visitId && f.review?.status==='accepted' &&
      f.review.actualKind==='barn' && f.review.data?.barn).sort((a,b)=>b.sequence-a.sequence)[0]??null;
    const page=frame?.review.data.barn;
    if(!page){reasons.push({visitId,reason:'unreviewed_barn_page'});previous=null;continue;}
    if(!Array.isArray(page.items) || !page.items.every(validItem) || new Set(page.items.map(i=>i.index)).size!==page.items.length ||
      !id(page.snapshotId) || !id(page.category) || typeof page.atStart!=='boolean' || typeof page.atEnd!=='boolean' ||
      !(page.usedCapacity===null || integer(page.usedCapacity)) || !(page.totalCapacity===null || integer(page.totalCapacity)))fail('BARN_PAGE_INVALID');
    pages.push({visitId,frameId:frame.id,observedAt:frame.observedAt,snapshotId:page.snapshotId,category:page.category,
      ...(eventTracked?{validity:{untilChange:true}}:{}),invalidated:!!state.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence,page});
    if(page.snapshotId!==snapshotId){reasons.push({visitId,reason:'barn_snapshot_changed'});previous=null;continue;}
    if(page.category!=='all'){reasons.push({visitId,reason:'filtered_inventory'});previous=null;continue;}
    const indices=page.items.map(i=>i.index).sort((a,b)=>a-b);
    if(indices.some((n,i)=>i && n!==indices[i-1]+1))reasons.push({visitId,reason:'page_item_gap'});
    if(previous && !indices.some(i=>previous.includes(i)))reasons.push({visitId,reason:'overlap_unverified'});
    if(previous && indices.length && indices.at(-1)<previous.at(-1))reasons.push({visitId,reason:'scroll_order_reversed'});
    for(const entry of page.items) {
      const value=itemIdentity(entry),old=items.get(entry.index);
      if(old && !equal(itemIdentity(old),value)){reasons.push({visitId,reason:'overlapping_item_conflict',index:entry.index});conflicted.add(entry.index);}
      else if(!old)items.set(entry.index,{...value,label:entry.label??null,frameId:frame.id,observedAt:frame.observedAt});
    }
    previous=indices;
  }
  if(!visitIds.length || pages.length!==visitIds.length)reasons.push({reason:'pages_incomplete'});
  const ordered=[...items.values()].sort((a,b)=>a.index-b.index);
  if(!pages[0]?.page.atStart || (ordered.length && ordered[0].index!==0))reasons.push({reason:'start_boundary_unverified'});
  if(!pages.at(-1)?.page.atEnd)reasons.push({reason:'end_boundary_unverified'});
  if(ordered.some((entry,i)=>entry.index!==i))reasons.push({reason:'item_coverage_gap'});
  if(!ordered.length && !pages.every(p=>p.page.usedCapacity===0))reasons.push({reason:'empty_inventory_unverified'});

  const readableHeaders=pages.length===visitIds.length && pages.length>0 && pages.every(p=>p.snapshotId===snapshotId &&
    integer(p.page.usedCapacity) && integer(p.page.totalCapacity));
  // An unreadable field elsewhere must not hide changes already seen in readable headers.
  const headersConflict=['usedCapacity','totalCapacity'].some(key=>
    new Set(pages.map(p=>p.page[key]).filter(integer)).size>1);
  const first=pages[0]?.page;
  const headersAgree=readableHeaders && !headersConflict;
  if(headersConflict)reasons.push({reason:'capacity_changed_during_scan'});
  const capacity={
    readComplete:!!headersAgree,
    usedCapacity:headersAgree?first.usedCapacity:null,
    totalCapacity:headersAgree?first.totalCapacity:null,
    freeCapacity:headersAgree?Math.max(0,first.totalCapacity-first.usedCapacity):null,
    overCapacity:headersAgree?Math.max(0,first.usedCapacity-first.totalCapacity):null,
    source:'displayed_barn_header',
    frameIds:pages.map(p=>p.frameId)
  };
  const byId=new Map();
  for(const entry of ordered)if(entry.itemId!==null){
    if(byId.has(entry.itemId)){
      conflicted.add(entry.index);conflicted.add(byId.get(entry.itemId));
      reasons.push({reason:'duplicate_item_identity',itemId:entry.itemId});
    }else byId.set(entry.itemId,entry.index);
  }
  const unreadableItems=ordered.filter(i=>conflicted.has(i.index) || i.itemId===null || i.quantity===null).map(i=>i.index);
  const inventory={};
  for(const entry of ordered)if(!unreadableItems.includes(entry.index))inventory[entry.itemId]=entry.quantity;
  const result={snapshotId,coverage:reasons.length?'partial':'complete',readComplete:reasons.length===0 && unreadableItems.length===0,
    expectedPages:visitIds.length,reviewedPages:pages.length,itemCount:ordered.length,
    pages:pages.map(({page,...meta})=>meta),items:ordered,inventory,unreadableItems,reasons,capacity,executionAllowed:false,reservationsCommitted:false};
  result.invalidated=pages.some(p=>p.invalidated);result.fresh=barnEvidenceFresh(result,{now,maxAgeMs});
  capacity.fresh=capacity.readComplete && result.fresh;
  return result;
}
