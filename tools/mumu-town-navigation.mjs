import {isUnresolvedAction,hasUnresolvedActions} from './mumu-input-state.mjs';
// Camera recovery proposals and one reviewed navigation step. No purchases,
// stock facts, approval, stop clearing, result inference or blind route replay.
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {PerceptionWorker} from './mumu-perception-bridge.mjs';
import {navigationMemory} from './mumu-memory.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';

const unresolved=s=>s.input||hasUnresolvedActions(s.actions??{});
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,60}$/.test(x);
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const median=a=>{const sorted=[...a].sort((x,y)=>x-y);return sorted[Math.floor(sorted.length/2)];};
const bitCount=Array.from({length:256},(_,n)=>{let count=0;for(;n;n&=n-1)count++;return count;});
const feature=f=>Number.isFinite(f?.x)&&Number.isFinite(f?.y)&&f.x>=185&&f.x<=1410&&f.y>=175&&f.y<=715&&/^[a-f0-9]{64}$/.test(f.descriptor??'');

// Additional navigation hold, never a semantic review. Small scattered motion
// can preserve an existing current-visit review; a moved camera or a new panel
// requires a current exception review. Targets still undergo exact preflight.
export function townViewStable(old,current){
  if(old.width!==1600||old.height!==900||current.width!==1600||current.height!==900||old.channels<3||old.channels!==current.channels)return false;
  let total=0,changed=0;
  for(let top=175;top<715;top+=128)for(let left=185;left<1410;left+=128){
    let count=0,diff=0;
    for(let y=top;y<Math.min(top+128,715);y++)for(let x=left;x<Math.min(left+128,1410);x++){
      const offset=(y*1600+x)*old.channels;count++;
      if([0,1,2].some(c=>Math.abs(old.pixels[offset+c]-current.pixels[offset+c])>12))diff++;
    }
    if(diff/count>.4)return false;
    total+=count;changed+=diff;
  }
  return changed/total<=.03;
}

// Translation is camera advice only. Moving people, repeated roofs, zoom and
// too little shared terrain abstain; returned offsets never authorize a tap.
export function estimateTownOffset(current,reference){
  if(!Array.isArray(current)||!Array.isArray(reference)||current.length>240||reference.length>240||
      current.some(f=>!feature(f))||reference.some(f=>!feature(f)))return null;
  const a=current.map(f=>({...f,bytes:Buffer.from(f.descriptor,'hex')})),b=reference.map(f=>({...f,bytes:Buffer.from(f.descriptor,'hex')}));
  const distances=a.map(x=>b.map(y=>x.bytes.reduce((n,v,i)=>n+bitCount[v^y.bytes[i]],0)));
  const pairs=[];
  for(let i=0;i<a.length;i++){
    const ranked=distances[i].map((d,j)=>({d,j})).sort((x,y)=>x.d-y.d);
    if(ranked.length<2||ranked[0].d>48||ranked[0].d>=ranked[1].d*.7)continue;
    const {j,d}=ranked[0];if(distances.some((row,k)=>k!==i&&row[j]<=d))continue;
    pairs.push({dx:b[j].x-a[i].x,dy:b[j].y-a[i].y,x:a[i].x,y:a[i].y});
  }
  if(pairs.length<12)return null;
  const dx=median(pairs.map(p=>p.dx)),dy=median(pairs.map(p=>p.dy));
  const inliers=pairs.filter(p=>Math.hypot(p.dx-dx,p.dy-dy)<=3);
  if(inliers.length<12||inliers.length/pairs.length<.8||
      Math.max(...inliers.map(p=>p.x))-Math.min(...inliers.map(p=>p.x))<250||
      Math.max(...inliers.map(p=>p.y))-Math.min(...inliers.map(p=>p.y))<150)return null;
  return {x:Math.round(dx),y:Math.round(dy),inliers:inliers.length,executionAllowed:false};
}

export function townNavigationStatus(state,matching){
  const hold=unresolved(state)?'INPUT_UNRESOLVED':state.stopCapture||state.stopReader?'SESSION_STOPPED':null;
  const town=matching?.scene?.kind==='town'&&matching.status==='candidate';
  const detections=town?(matching.detections??[]).filter(d=>d.status==='matched_candidate'):[];
  return {status:hold?'hold':town?'town_candidate':'waiting',reason:hold??matching?.reason??null,
    helicopterShortcut: detections.find(d=>d.objectId==='helicopter-town-shortcut')?.box??null,
    helicopterReadyCandidate:!!detections.find(d=>d.objectId==='helicopter-town-ready'),
    market: detections.find(d=>d.objectId==='market-building')?.box??null,
    occlusionVerified:false,requiresCurrentTargetReview:true,executionAllowed:false};
}

function reviewedTown(state,now){
  return Object.values(state.frames).filter(f=>f.epoch===state.scene.epoch&&f.sceneId===state.scene.id&&
    f.review?.status==='accepted'&&['GPT','program-exact'].includes(f.review.reviewedBy)&&f.review.actualKind==='town'&&
    f.review.quality.gameVisible&&!f.review.quality.occluded&&inputEvidenceValid(f,now,state))
    .sort((a,b)=>b.sequence-a.sequence)[0];
}
function history(state,searchId){
  if(!searchId)return [];
  return Object.values(state.actions).filter(a=>a.id.startsWith('town-nav-'+searchId+'-')).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
function swipeIn(box,direction){
  const inset=10,cx=Math.floor(box.x+box.width/2),cy=Math.floor(box.y+box.height/2);
  const dx=Math.floor(Math.min(240,(box.width-2*inset)/2)),dy=Math.floor(Math.min(160,(box.height-2*inset)/2));
  if(direction.x&&dx<20||direction.y&&dy<20)return null;
  return {x1:cx-direction.x*dx,y1:cy-direction.y*dy,x2:cx+direction.x*dx,y2:cy+direction.y*dy,durationMs:900};
}

export async function prepareTownNavigation(store,{facilityKind='helicopter',searchId=null,offline=true,maxSteps=8}={},
  {worker=null,matching=null}={}){
  if(!['helicopter','market'].includes(facilityKind)||searchId!==null&&!token(searchId)||
      typeof offline!=='boolean'||!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>12)throw Error('TOWN_NAVIGATION_REQUEST_INVALID');
  const state=store.load(),evidence=store.evidence(state.latestFrameId),actions=history(state,searchId);
  const prior=actions.filter(a=>a.status==='verified'&&a.target.kind==='town_scroll');
  const ownWorker=!worker;
  try{
    if(!matching){worker??=new PerceptionWorker();matching=await worker.analyze(evidence.frame,evidence.bytes,{offline,scope:'navigation'});}
    const base={schema:1,facilityKind,searchId,maxSteps,frameId:evidence.frame.id,evidenceHash:evidence.frame.evidenceHash,
      epoch:evidence.frame.epoch,completedScrolls:prior.length,executionAllowed:false,requiresCurrentTargetReview:true,
      matching,town:townNavigationStatus(state,matching)};
    const hold=reason=>({...base,status:'hold',reason,proposal:null});
    if(matching.frameId!==evidence.frame.id||matching.evidenceHash!==evidence.frame.evidenceHash||matching.epoch!==evidence.frame.epoch)
      return hold('CURRENT_MATCHING_REQUIRED');
    if(unresolved(state))return hold('INPUT_UNRESOLVED');
    if(matching.status!=='candidate'||matching.scene.kind!=='town')return hold(matching.reason??'TOWN_SCREEN_REQUIRED');
    if(actions.some(a=>a.status!=='verified'))return hold('NAVIGATION_ACTION_RECONCILIATION_REQUIRED');
    const identity=facilityKind==='helicopter'?'helicopter-town-shortcut':'market-building';
    const detection=matching.detections.find(d=>d.objectId===identity&&d.status==='matched_candidate');
    const review=reviewedTown(state,store.clock()),kind='open_'+facilityKind;
    if(review&&review.id!==evidence.frame.id&&!townViewStable(store.evidence(review.id).image,evidence.image))
      return hold('TOWN_VIEW_CHANGED_REVIEW_REQUIRED');
    const currentTargets=review?.review.targets??[];
    if(detection){
      const nearby={...detection.box,y:Math.max(0,detection.box.y-80),height:detection.box.height+160};
      const target=currentTargets.find(t=>t.kind===kind&&t.type==='tap'&&overlap(t.box,nearby));
      return {...base,status:target?'ready':'needs_review',reason:target?null:'CURRENT_TOWN_TARGET_REVIEW_REQUIRED',
        proposal:{kind,type:'tap',box:detection.box,targetId:target?.id??null,reviewFrameId:target?review.id:null,
          method:facilityKind==='helicopter'?'visible_shortcut':'visible_static_building',readinessInferred:false}};
    }
    if(prior.length>=maxSteps)return hold('TOWN_SEARCH_LIMIT_REACHED');
    if(prior.some(a=>state.frames[a.resultFrameId]?.review?.actualKind!=='town'))return hold('TOWN_SCROLL_RESULT_REQUIRED');
    const references=new Map();
    for(const action of prior)references.set(action.frameId,{frameId:action.frameId,role:'visited'});
    for(const entry of navigationMemory(state,{facilityKind}).entries.filter(e=>e.outcome==='confirmed_facility'&&e.status==='reference').reverse()){
      if(references.size>=16)break;
      references.set(entry.sourceFrameId,{frameId:entry.sourceFrameId,role:'facility',targetId:entry.targetId});
    }
    let position=null;
    for(const reference of references.values()){
      worker??=new PerceptionWorker();
      const old=store.evidence(reference.frameId),result=await worker.analyze({...old.frame,kind:'unknown'},old.bytes,{offline:true,scope:'navigation'});
      const offset=estimateTownOffset(matching.townFeatures,result.townFeatures);if(!offset)continue;
      if(reference.role==='visited'&&Math.hypot(offset.x,offset.y)<=8)return hold('TOWN_CAMERA_NO_PROGRESS_OR_REPEATED_VIEW');
      if(reference.role==='facility'){
        const oldTarget=old.frame.review.targets.find(t=>t.id===reference.targetId);
        position={x:Math.round(oldTarget.box.x+oldTarget.box.width/2-offset.x),
          y:Math.round(oldTarget.box.y+oldTarget.box.height/2-offset.y),referenceFrameId:old.frame.id,offset};break;
      }
    }
    const directions=[{x:0,y:1},{x:-1,y:0},{x:0,y:-1},{x:0,y:-1},
      {x:1,y:0},{x:1,y:0},{x:0,y:1},{x:0,y:1},{x:0,y:1},{x:-1,y:0},{x:-1,y:0},{x:-1,y:0}];
    // Screen-space displacement: an offscreen market on the left needs a
    // rightward drag. A remembered coordinate is never returned as a tap.
    if(position&&position.x>=185&&position.x<=1410&&position.y>=175&&position.y<=715)
      return hold('REMEMBERED_FACILITY_NOT_RECOGNIZED');
    const direction=position?{x:position.x<185?1:position.x>1410?-1:0,y:position.y<175?1:position.y>715?-1:0}:directions[prior.length];
    const target=currentTargets.find(t=>t.kind==='town_scroll'&&t.type==='swipe'&&swipeIn(t.box,direction));
    return {...base,status:target?'ready':'needs_review',reason:target?null:'CURRENT_TOWN_SCROLL_REVIEW_REQUIRED',
      proposal:{kind:'town_scroll',type:'swipe',method:position?'remembered_facility_direction':'bounded_search',
        direction,positionHint:position,targetId:target?.id??null,reviewFrameId:target?review.id:null,
        box:target?.box??null,swipe:target?swipeIn(target.box,direction):null,
        suggestedRegion:{x:420,y:230,width:760,height:460}}};
  }finally{if(ownWorker)worker?.close();}
}

export async function navigateTown(store,{source,facilityKind='helicopter',searchId,maxSteps=8}={},options={}){
  if(source!=='explicit_user'||!token(searchId))throw Error('EXPLICIT_TOWN_NAVIGATION_REQUIRED');
  function guard(state){
    if(state.stopCapture||state.stopReader||options.signal?.aborted)throw Error('SESSION_STOPPED');
    if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')throw Error('MANAGEMENT_APPROVAL_REQUIRED');
    if(unresolved(state))throw Error('INPUT_UNRESOLVED');
    const capture=join(store.root,'capture.lock');
    if(existsSync(capture)&&JSON.parse(readFileSync(capture,'utf8')).pid!==process.pid)throw Error('CAPTURE_PRODUCER_NOT_OWNED');
    if(existsSync(join(store.root,'.management','runner.lock'))||existsSync(join(store.root,'helicopter-runner.lock')))
      throw Error('DELIVERY_RUNNER_NOT_OWNED');
  }
  guard(store.load());
  const prepared=await prepareTownNavigation(store,{facilityKind,searchId,maxSteps,offline:false},options);
  if(prepared.status!=='ready')return prepared;
  guard(store.load());
  if(store.load().latestFrameId!==prepared.frameId)throw Error('CURRENT_FRAME_REQUIRED');
  const p=prepared.proposal,actionId='town-nav-'+searchId+'-'+history(store.load(),searchId).length;
  const baseline=store.load(),policyHash=digest(Buffer.from(JSON.stringify(baseline.session.management)));
  const request={actionId,frameId:p.reviewFrameId,targetId:p.targetId,swipe:p.swipe??null,
    nextVisit:{visitId:actionId+'-result',kind:p.kind==='town_scroll'?'town':facilityKind,entityId:null}};
  const beforeBegin=state=>{
    guard(state);
    if(state.latestFrameId!==prepared.frameId||state.scene.epoch!==prepared.epoch||
        digest(Buffer.from(JSON.stringify(state.session.management)))!==policyHash)throw Error('TOWN_NAVIGATION_CONTEXT_CHANGED');
  };
  const beforeInputGuard=state=>{
    if(options.signal?.aborted||digest(Buffer.from(JSON.stringify(state.session.management)))!==policyHash)
      throw Error('TOWN_NAVIGATION_CONTEXT_CHANGED');
    const capture=join(store.root,'capture.lock');
    if(existsSync(capture)&&JSON.parse(readFileSync(capture,'utf8')).pid!==process.pid)throw Error('CAPTURE_PRODUCER_NOT_OWNED');
    if(Object.values(state.actions).some(a=>a.id!==actionId&&isUnresolvedAction(a)))throw Error('INPUT_UNRESOLVED');
    if(existsSync(join(store.root,'.management','runner.lock'))||existsSync(join(store.root,'helicopter-runner.lock')))
      throw Error('DELIVERY_RUNNER_NOT_OWNED');
  };
  // Validate the whole map view again on the immediate preflight screenshot;
  // the existing target/anchor comparison remains an independent input gate.
  const device=options.device??new (await import('./adb.mjs')).AdbDevice(baseline.session);
  const guardedDevice={navigate:(...args)=>device.navigate(...args),capture:async()=>{
    const packet=await device.capture();
    if(!townViewStable(store.evidence(prepared.frameId).image,packet.image))throw Error('TOWN_VIEW_CHANGED_BEFORE_INPUT');
    return packet;
  }};
  const result=await navigateReviewed(store,request,{device:guardedDevice,beforeBegin,beforeInputGuard});
  return {status:'waiting_result',actionId,actionStatus:result.status??result.action?.status,
    next:'CONFIRM_NEW_RESULT_BEFORE_NEXT_INPUT',executionAllowed:false};
}
