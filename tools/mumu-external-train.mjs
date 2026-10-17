import {resolvePercentageProfile} from './percentage-profile.mjs';
import {isUnresolvedAction,hasUnresolvedActions} from './mumu-input-state.mjs';
// Manager-only reconciliation after explicitly reported manual train departure.
// It never decides that an unknown input succeeded, accounts goods, or resumes.
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng} from './adb.mjs';
import {inventorySourceFingerprint} from './mumu-inventory-store.mjs';
import {invalidateMarket} from './mumu-market-state.mjs';
const profileFile=new URL('../reference/train-transit/profile.json',import.meta.url);
const sha=value=>digest(Buffer.from(JSON.stringify(value)));
const fail=code=>{throw Error(code);};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
export function readTrainTransit(image){
 const raw=readFileSync(profileFile),profile=resolvePercentageProfile(JSON.parse(raw)),assets=new Map();
 if(profile.schema!==1||image.width!==1600||image.height!==900||image.channels<3)return {supported:false,rows:[]};
 for(const a of profile.assets){
  if(a.file!==a.file.split(/[\\/]/).at(-1))fail('TRANSIT_ASSET_CHANGED');
  const bytes=readFileSync(join(dirname(fileURLToPath(profileFile)),a.file));if(digest(bytes)!==a.sha256)fail('TRANSIT_ASSET_CHANGED');
  assets.set(a.file,decodePng(bytes));
 }
 const matches=spec=>{
  const b=spec.box,t=assets.get(spec.file);if(!t||t.width!==b.width||t.height!==b.height)return false;let changed=0;
  for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
   const p=((b.y+y)*image.width+b.x+x)*image.channels,q=(y*b.width+x)*t.channels;
   if([0,1,2].some(c=>Math.abs(image.pixels[p+c]-t.pixels[q+c])>12))changed++;
  }
  return changed/(b.width*b.height)<=.03;
 };
 if(!profile.anchors.every(matches))return {supported:false,rows:[]};
 return {supported:true,rows:profile.rows.filter(r=>r.regions.every(matches)).map(r=>r.row),profileHash:digest(raw)};
}
function externalEvidence(request,state,action,now){
 const e=request.evidence;
 if(e?.provider!=='mumu_adb'||e.serial!==state.session.serial||e.packageName!==state.session.packageName||
  typeof e.path!=='string'||!/^[a-f0-9]{64}$/.test(e.evidenceHash??'')||!Number.isFinite(Date.parse(e.captureStartedAt))||
  !Number.isFinite(Date.parse(e.observedAt))||Date.parse(e.observedAt)<Date.parse(e.captureStartedAt)||Date.parse(e.observedAt)>now||
  Date.parse(e.captureStartedAt)<Date.parse(action.finishedAt)+1000||!Number.isFinite(Date.parse(action.finishedAt)))fail('EXTERNAL_TRAIN_EVIDENCE_REQUIRED');
 const bytes=readFileSync(e.path);if(digest(bytes)!==e.evidenceHash)fail('EXTERNAL_ORIGINAL_CHANGED');
 const transit=readTrainTransit(decodePng(bytes));
 if(!transit.supported||!request.completedRows.every(r=>transit.rows.includes(r)))fail('MANUALLY_COMPLETED_TRAIN_NOT_IN_TRANSIT');
 return {...structuredClone(e),profileHash:transit.profileHash,completedRows:[...request.completedRows]};
}
function pausedBoundary(store,state){
 if(!state.stopCapture||!state.stopReader)fail('BOTH_STOPS_REQUIRED');
 if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')fail('MANAGEMENT_APPROVAL_REQUIRED');
 for(const file of ['capture.lock','helicopter-runner.lock','.management/runner.lock'])if(existsSync(join(store.root,file)))fail('EXCLUSIVE_STOPPED_BOUNDARY_REQUIRED');
}
export function reconcileExternalTrain(store,inventory,request){
 if(request?.source!=='explicit_user'||request.confirmation!=='user_manually_loaded_and_dispatched'||
  !validId(request.resolutionId)||!validId(request.actionId)||typeof request.reason!=='string'||!request.reason.trim()||
  !Array.isArray(request.completedRows)||!request.completedRows.length||new Set(request.completedRows).size!==request.completedRows.length||
  !request.completedRows.every(r=>[1,2].includes(r))||!Number.isSafeInteger(request.expectedSourceRevision))fail('EXPLICIT_EXTERNAL_TRAIN_CONFIRMATION_REQUIRED');
 if(inventory?.source!==store||!existsSync(inventory.file))fail('EXISTING_INVENTORY_REQUIRED');
 const requestHash=sha(request);
 const proofFile=join(store.root,'.management','external-train-resolutions',request.resolutionId+'.json');
 const receipt=inventory.locked(state=>{
  pausedBoundary(store,state);
  const record=inventory.load(state),old=state.externalTrainResolutions?.[request.resolutionId];
  if(old){
   if(old.requestHash!==requestHash)fail('EXTERNAL_RESOLUTION_ID_REUSED');
   // A separate, exclusively created original anchors retries after a partial
   // source/ledger write. Mutable state alone cannot authorize pruning orders.
   if(!existsSync(proofFile))fail('EXTERNAL_RESOLUTION_PROOF_REQUIRED');
   const proof=JSON.parse(readFileSync(proofFile,'utf8'));
   if(sha(proof.request)!==requestHash||sha(proof.receipt)!==sha(old))fail('EXTERNAL_RESOLUTION_CHANGED');
   const expected={...old.originalAction,status:'externally_superseded',externalResolutionId:request.resolutionId};
   if(sha(state.actions[request.actionId])!==sha(expected))fail('EXTERNAL_ACTION_CHANGED');
   const expectedMission={...old.originalMission,status:'externally_superseded',waitingActionId:null,externalResolutionId:request.resolutionId};
   if(sha(state.transportMissions?.[old.missionId])!==sha(expectedMission))fail('EXTERNAL_MISSION_CHANGED');
   if(state.input||hasUnresolvedActions(state.actions))fail('EXCLUSIVE_STOPPED_BOUNDARY_REQUIRED');
   return structuredClone(old);
  }
  if(existsSync(proofFile))fail('EXTERNAL_RESOLUTION_ORPHAN_PROOF');
  if(state.revision!==request.expectedSourceRevision)fail('SOURCE_REVISION_CONFLICT');
  const a=state.actions[request.actionId],unresolved=Object.values(state.actions).filter(isUnresolvedAction);
  if(state.input!==request.actionId||unresolved.length!==1||a?.status!=='unknown'||a.management!==true||a.lifecycle||
   a.target?.kind!=='load_train'||a.target.management?.currency!=='NONE'||a.inputAttempted!==true||a.resultProof||a.resultFrameId)fail('ONLY_UNKNOWN_TRAIN_LOAD_REQUIRED');
  const row=Number(/^r([12])-c\d+$/.exec(a.target.management?.slotId??'')?.[1]);
  if(!request.completedRows.includes(row))fail('COMPLETED_ROW_MISMATCH');
  const frame=store.evidence(a.frameId).frame;
  if(frame.review?.status!=='accepted'||frame.review.actualKind!=='train'||frame.review.data?.train?.fullDemandConfirmed!==true||
   frame.review.data.train.selectedCarriage!==a.target.management.slotId||
   !frame.review.data.order?.needs?.some(n=>n.slotId===a.target.management.slotId&&n.itemId===a.target.management.itemId&&n.required===a.target.management.required))fail('ORIGINAL_TRAIN_SCOPE_REQUIRED');
  if(!a.preflightEvidence||digest(readFileSync(a.preflightEvidence.evidenceRef))!==a.preflightEvidence.evidenceHash)fail('ORIGINAL_PREFLIGHT_CHANGED');
  const missions=Object.entries(state.transportMissions??{}).filter(([,m])=>m.waitingActionId===a.id);
  if(missions.length!==1||missions[0][1].status!=='waiting_result'||missions[0][1].receipts?.some(r=>r.actionId===a.id)||
   record.effects.some(e=>e.actionId===a.id)||Object.values(state.helicopterRounds??{}).some(r=>r.actionIds?.includes(a.id)))fail('EXTERNAL_MISSION_SCOPE_REQUIRED');
  const evidence=externalEvidence(request,state,a,store.clock()),[missionId,mission]=missions[0];
  const obsoleteOrderFrameIds=record.orderFrameIds.filter(id=>{
   const data=state.frames[id]?.review?.data,needs=data?.order?.needs;
   if(!Array.isArray(needs)||!needs.length)return false;
   return request.completedRows.some(row=>needs.every(n=>typeof n.slotId==='string'&&n.slotId.startsWith('r'+row+'-c')));
  });
  const resolved={schema:1,id:request.resolutionId,requestHash,actionId:a.id,missionId,recordedAt:new Date(store.clock()).toISOString(),
   source:'explicit_user',confirmation:request.confirmation,reason:request.reason,evidence,
   originalAction:structuredClone(a),originalMission:structuredClone(mission),obsoleteOrderFrameIds,originalInputOutcome:'unknown',
   disposition:'superseded_by_manual_departure',deliverySuccessClaimed:false,inventoryDeltas:[],stopsPreserved:true};
  state.externalTrainResolutions??={};state.externalTrainResolutions[request.resolutionId]=resolved;
  a.status='externally_superseded';a.externalResolutionId=request.resolutionId;
  mission.status='externally_superseded';mission.waitingActionId=null;mission.externalResolutionId=request.resolutionId;
  state.input=null;state.observationWait=null;
  state.observationInvalidation={sequence:state.sequence,at:resolved.recordedAt,reason:'Manual train completion: '+request.reason,externalResolutionId:request.resolutionId};
  const visitId='external-train:'+request.resolutionId;
  if(state.visits[visitId])fail('VISIT_ID_REUSED');
  state.scene={id:visitId,kind:'train',entityId:null,epoch:state.scene.epoch+1,required:true,roi:null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
  state.visits[visitId]={...structuredClone(state.scene),startedAt:resolved.recordedAt,status:'awaiting_capture',frameId:null};
  state.latestCandidateFrameId=null;
  if(state.marketView)invalidateMarket(state,'external_manual_train_completion');
  state.revision++;
  mkdirSync(dirname(proofFile),{recursive:true});
  writeFileSync(proofFile,JSON.stringify({request:structuredClone(request),receipt:resolved},null,2)+'\n',{flag:'wx'});
  store.save(state);return structuredClone(resolved);
 });
 // Source is saved first. A failed sidecar write stays requiresSync, with both
 // stops set; retrying this exact request completes sync without another effect.
 const current=store.load(),record=inventory.locked(s=>inventory.load(s));
 if(!record.operations.some(op=>op.mutationId==='external-train:'+request.resolutionId)&&record.sourceFingerprint!==inventorySourceFingerprint(current))inventory.commit('sync',{
  mutationId:'external-train:'+request.resolutionId,expectedSourceRevision:current.revision,expectedRevision:record.revision,
  orderFrameIds:record.orderFrameIds.filter(id=>!receipt.obsoleteOrderFrameIds.includes(id))});
 const status=inventory.status();
 return {receipt,requiresSync:status.requiresSync,executionAllowed:false,stopCapture:current.stopCapture,stopReader:current.stopReader};
}
