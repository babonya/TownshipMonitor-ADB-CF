// Read-only progress for historical refresh records; new requests are retired.
import {barnCoverage} from './mumu-barn.mjs';
import {marketCoverage} from './mumu-survey.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';

const orderKey=f=>f.review.actualKind+':'+(f.review.actualEntityId??'panel');
export function refreshProgress(state,now=Date.now()){
  const request=state.observationRefresh;if(!request)return null;
  const after=Date.parse(request.requestedAt);
  const frames=Object.values(state.frames).filter(f=>f.sequence>request.afterSequence&&Date.parse(f.captureStartedAt)>=after&&
    acceptedFacts(f)&&inputEvidenceValid(f,now,state));
  const view={...state,frames:Object.fromEntries(frames.map(f=>[f.id,f]))};
  const progress={};
  for(const section of request.sections){
    let complete=false,evidence=[];
    if(section==='screen'){const known=frames.filter(f=>f.review.actualKind!=='unknown');complete=known.length>0;evidence=known.slice(-1).map(f=>f.id);}
    if(section==='orders'){
      const orders=frames.filter(f=>['helicopter','train','airport'].includes(f.review.actualKind)&&
        (f.review.data?.noOrders===true||f.review.data?.order?.orderId&&Array.isArray(f.review.data.order.needs)&&
          f.review.data.order.needs.every(n=>typeof n.itemId==='string'&&Number.isSafeInteger(n.required)&&n.required>0)));
      const found=new Set(orders.map(orderKey));
      for(const frame of orders.filter(f=>f.review.data?.noOrders===true))
        for(const key of request.expectedOrders.filter(k=>k.startsWith(frame.review.actualKind+':')))found.add(key);
      let expected=[...request.expectedOrders];
      // A newly observed complete roster can replace customers/trains that no
      // longer exist after manual play. Every current detail still needs proof.
      for(const frame of frames){
        const roster=frame.review.data?.ordersCoverage;
        if(roster?.complete===true&&roster.kind===frame.review.actualKind&&['helicopter','train','airport'].includes(roster.kind)&&
          Array.isArray(roster.entityIds)&&roster.entityIds.length&&roster.entityIds.every(id=>typeof id==='string'&&id.length)&&
          new Set(roster.entityIds).size===roster.entityIds.length)
          expected=[...expected.filter(key=>!key.startsWith(roster.kind+':')),...roster.entityIds.map(id=>roster.kind+':'+id)];
      }
      complete=expected.length?expected.every(key=>found.has(key)):orders.length>0;
      evidence=orders.map(f=>f.id);
    }
    if(section==='inventory'){
      const owned=frames.filter(f=>['helicopter','train','airport'].includes(f.review.actualKind)&&f.review.data?.order?.needs?.some(n=>
        typeof n.itemId==='string'&&Number.isSafeInteger(n.owned)&&n.owned>=0));
      if(owned.length){
        complete=true;evidence.push(...owned.map(f=>f.id));
        progress[section]={scope:'observed_products',coverage:'partial',itemIds:[...new Set(owned.flatMap(f=>f.review.data.order.needs
          .filter(n=>typeof n.itemId==='string'&&Number.isSafeInteger(n.owned)&&n.owned>=0).map(n=>n.itemId)))]};
      }
      const snapshots=new Set(frames.filter(f=>f.review.data?.barn).map(f=>f.review.data.barn.snapshotId));
      for(const snapshotId of snapshots){
        const visits=[...new Set(frames.filter(f=>f.review.data?.barn?.snapshotId===snapshotId).sort((a,b)=>a.sequence-b.sequence).map(f=>f.sceneId))];
        try{const barn=barnCoverage(view,{snapshotId,visitIds:visits,now,eventTracked:true});
          evidence.push(...barn.pages.map(p=>p.frameId));if(barn.readComplete&&barn.capacity.fresh)complete=true;
        }catch{}
      }
    }
    if(section==='market'){
      const rounds=new Set(frames.filter(f=>f.review.data?.market).map(f=>f.review.data.market.roundId));
      for(const roundId of rounds){
        const visits=[...new Set(frames.filter(f=>f.review.data?.market?.roundId===roundId).sort((a,b)=>a.sequence-b.sequence).map(f=>f.sceneId))];
        try{const market=marketCoverage(view,{roundId,visitIds:visits});evidence.push(...market.pages.map(p=>p.frameId));if(market.readComplete)complete=true;}catch{}
      }
    }
    if(section==='resources'){
      evidence=frames.filter(f=>Number.isSafeInteger(f.review.data?.resources?.coinBalance)&&f.review.data.resources.coinBalance>=0).map(f=>f.id);
      complete=evidence.length>0;
    }
    progress[section]={...progress[section],status:complete?'complete':evidence.length?'partial':'pending',frameIds:[...new Set(evidence)]};
  }
  const complete=Object.values(progress).every(p=>p.status==='complete');
  return {...request,status:complete?'complete':frames.length?'reviewing':request.firstFrameId?'awaiting_review':'requested',progress,
    pendingSections:Object.entries(progress).filter(([,p])=>p.status!=='complete').map(([s])=>s),
    blockedBy:state.input?'INPUT_UNRESOLVED':state.stopCapture||state.stopReader?'SESSION_STOPPED':null};
}
