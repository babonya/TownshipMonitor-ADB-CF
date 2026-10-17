import {readInventoryRecord} from './mumu-inventory-record.mjs';
import {isUnresolvedAction,hasUnresolvedActions,terminalTransportMission} from './mumu-input-state.mjs';
// Durable derived reservations. This module owns no game inputs or runtime reviews.
import {auditedCupNoDispatch} from './mumu-mayors-cup-audit.mjs';
import {existsSync,readFileSync,mkdirSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {sameRootPath} from './mumu-path-identity.mjs';
import {MumuStore} from './mumu-store.mjs';
import {acquireStateLock,atomic} from './mumu-persistence.mjs';
import {digest} from './adb.mjs';
import {deriveInventory,allocateInventory,inventoryUnchangedDeletion} from './mumu-inventory.mjs';
import {evidenceWindow} from './mumu-freshness.mjs';
import {demandAffected,advanceCapacity,validateNumericMetadata} from './mumu-accounting.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';
import {protectedTrainReceipt} from './mumu-train-reward-proof.mjs';
import {snapshotEvidenceStore} from './mumu-monitor-evidence.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
import {findInventoryOperation,checkpointInventoryOperations} from './mumu-inventory-journal.mjs';

const VERSION='township-inventory-1';
const fail=code=>{throw Error(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
const clone=x=>structuredClone(x);
const fresh=(time,now,maxAgeMs=null)=>evidenceWindow({observedAt:time},{now,maxAgeMs}).valid;
const catalog=JSON.parse(readFileSync(new URL('../reference/product-catalog.json',import.meta.url),'utf8'));
const ordinary=new Set(catalog.items.filter(x=>['crop','farm','factory','feed','island'].includes(x.category)&&x.itemId).map(x=>x.itemId));

// Source revisions also count captures, OCR work and observation requests. Only
// accepted inventory/demand facts and tracked mutations invalidate allocation.
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])])):value;
const projectionFacts=({sourceRevision,createdAt,...facts})=>facts;
export function inventorySourceFingerprint(state){
  const frames=Object.values(state.frames??{}).filter(f=>acceptedFacts(f)&&
    ['order','barn','resources','actionResult'].some(k=>f.review.data?.[k]!==undefined)).map(f=>({
      id:f.id,evidenceHash:f.evidenceHash,sequence:f.sequence,epoch:f.epoch,sceneId:f.sceneId,observedAt:f.observedAt,
      actualKind:f.review.actualKind,data:Object.fromEntries(['order','barn','resources','actionResult']
        .filter(k=>f.review.data?.[k]!==undefined).map(k=>[k,f.review.data[k]]))})).sort((a,b)=>a.id.localeCompare(b.id));
  const actions=Object.values(state.actions??{}).filter(a=>a.management===true||isUnresolvedAction(a))
    .map(a=>({id:a.id,status:a.status,management:a.management,frameId:a.frameId,resultFrameId:a.resultFrameId,
      target:a.target,inputAttempted:a.inputAttempted,resultProof:a.resultProof,
      ...(a.target?.kind==='claim_mayors_cup_reward'?{rewardInputReservedAt:a.inputReservedAt??null}:{})})).sort((a,b)=>a.id.localeCompare(b.id));
  return sha(stable({schema:1,frames,actions,input:state.input??null,observationInvalidation:state.observationInvalidation??null,
    ...(state.orderDemandStartup?{orderDemandCutoff:state.orderDemandStartup.cutoffSequence}:{})}));
}
export function inventoryRequiresSync(state,record){
  return typeof record.sourceFingerprint==='string'?record.sourceFingerprint!==inventorySourceFingerprint(state):record.sourceRevision!==state.revision;
}

function reviewed(state,source,frameId){
  const frame=state.frames?.[frameId],review=frame?.review;
  if(!acceptedFacts(frame))fail('REVIEWED_SOURCE_REQUIRED');
  const evidence=source.evidence(frameId);
  if(evidence.frame.evidenceHash!==frame.evidenceHash)fail('SOURCE_FRAME_CHANGED');
  return frame;
}
function orderFromFrame(state,source,frameId,now,maxAgeMs,effects,eventTracked=false){
  const frame=reviewed(state,source,frameId),data=frame.review.data?.order;
  const transport={airport:'plane',train:'train',helicopter:'helicopter'}[frame.review.actualKind];
  if(!transport||!id(data?.orderId)||!['normal','special'].includes(data.kind)||!Array.isArray(data.needs)||!data.needs.length)fail('REVIEWED_ORDER_REQUIRED');
  if(data.transport!==undefined&&data.transport!==transport)fail('ORDER_TRANSPORT_MISMATCH');
  const newer=Object.values(state.frames).some(f=>f.id!==frameId&&acceptedFacts(f)&&
    f.review.data?.order?.orderId===data.orderId&&Date.parse(f.observedAt)>Date.parse(frame.observedAt));
  const productList=data.identityMode==='product_list'&&data.orderConfirmed===true;
  let supported=data.kind==='normal'&&(data.orderConfirmed!==undefined?data.orderConfirmed===true: data.bindingConfirmed!==false)&&
    (productList||data.bindingConfirmed!==false);
  const items=data.needs.map(need=>{
    if(!(need.itemId===null||id(need.itemId))||!(need.required===null||integer(need.required)&&need.required>0))fail('ORDER_NEED_INVALID');
    if(!ordinary.has(need.itemId))supported=false;
    return {itemId:need.itemId,quantity:need.required};
  });
  // Stock changes trigger reallocation. Only changes to this order invalidate
  // its remaining demand; unknown effect scope keeps the conservative hold.
  const changed=effects.some(e=>(Date.parse(e.observedAt)>Date.parse(frame.observedAt)||
      Date.parse(e.observedAt)===Date.parse(frame.observedAt)&&e.frameId!==frame.id)&&
    demandAffected(state,e,data,items));
  const invalidated=!!state.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence;
  const validity={...data.validity,...eventTracked?{untilChange:true}:{}};
  const window=evidenceWindow({...data,validity,observedAt:frame.observedAt},{now,maxAgeMs});
  return {orderId:data.orderId,transport,items,disposition:orderDisposition(data.needs),confirmed:supported&&!newer&&!changed&&!invalidated,
    operation:data.kind==='normal'?'load_from_inventory':'unsupported_special_order',
    validity,invalidated,...(window.basis==='observed_deadline'?{deadline:window.validUntil}:data.deadline!==undefined?{deadline:data.deadline}:{}),...(data.remainingSeconds!==undefined?{remainingSeconds:data.remainingSeconds}:{}),
    source:{frameId,evidenceHash:frame.evidenceHash,observedAt:frame.observedAt},
    holdReason:!supported?'PROTECTED_OR_UNSUPPORTED_PRODUCT':newer?'ORDER_SOURCE_SUPERSEDED':changed?'ORDER_REVIEW_AFTER_EFFECT_REQUIRED':
      invalidated?'OBSERVATION_CHANGED':!window.valid?'ORDER_STALE':null};
}
function effectFromAction(state,source,actionId){
  const action=state.actions?.[actionId];
  if(action?.status!=='verified'||action.management!==true||!id(action.resultFrameId))fail('CONFIRMED_NUMERIC_EFFECT_REQUIRED');
  const frame=state.frames[action.resultFrameId],effect=actionEffect(state,action);
  source.evidence(frame.id);
  const deltas=effect?.inventoryDeltas??[],invalidated=effect?.inventoryInvalidated??[];
  const inventoryUnchanged=inventoryUnchangedDeletion(state,action,effect);
  const protectedReward=protectedTrainReceipt(state,action,effect);
  if(protectedReward)source.evidence(action.frameId);
  if(effect?.confirmed!==true||effect.actionId!==actionId||effect.frameId!==frame.id||!Array.isArray(deltas)||!Array.isArray(invalidated)||
      (!deltas.length&&!invalidated.length&&!inventoryUnchanged&&!protectedReward)||invalidated.some(x=>!id(x))||new Set(invalidated).size!==invalidated.length)fail('CONFIRMED_NUMERIC_EFFECT_REQUIRED');
  const seen=new Set();
  validateNumericMetadata(effect);
  for(const delta of deltas){
    if(!id(delta.itemId)||seen.has(delta.itemId)||!integer(delta.before)||!integer(delta.after))fail('INVENTORY_EFFECT_INVALID');
    seen.add(delta.itemId);
  }
  return {actionId,frameId:frame.id,evidenceHash:frame.evidenceHash,observedAt:frame.observedAt,
    sequence:frame.sequence,epoch:frame.epoch,orderId:effect.deletedOrderId??effect.orderId??effect.completedOrderId??null,deltas:clone(deltas),
    ...(inventoryUnchanged?{inventoryUnchanged:true}:{}),
    ...(protectedReward?{protectedRewardReceipt:clone(effect.trainRewardReceipt)}:{}),
    ...(invalidated.length?{invalidatedItems:clone(invalidated)}:{}),
    ...(effect.capacityDelta?{capacityDelta:clone(effect.capacityDelta)}:{}),...(effect.coinDelta?{coinDelta:clone(effect.coinDelta)}:{})};
}

export class InventoryStore {
  constructor({source,root,clock=Date.now,save=atomic}={}){
    if(!(source instanceof MumuStore)||!root)fail('INVENTORY_EXPLICIT_PATHS_REQUIRED');
    this.source=source;this.root=resolve(root);this.clock=clock;this.save=save;
    this.allocationKind='legacy_inventory';
    this.accounting=Object.freeze({read:state=>this.load(state),commit:(...args)=>this.commit(...args)});
    mkdirSync(this.root,{recursive:true});this.file=join(this.root,'inventory.json');this.lockFile=join(this.root,'inventory.lock');
  }
  locked(fn){
    // All processes take the canonical source lock before the sidecar lock.
    const sourceFd=acquireStateLock(this.source.lockFile);let inventoryFd;
    try{inventoryFd=acquireStateLock(this.lockFile);return fn(this.source.load());}
    finally{if(inventoryFd!==undefined){closeSync(inventoryFd);unlinkSync(this.lockFile);}closeSync(sourceFd);unlinkSync(this.source.lockFile);}
  }
  load(state){return readInventoryRecord(this.root,this.source.root,state);}
  rebuild(state,record,source=this.source){
    const now=this.clock(),config=record.config,eventTracked=config.freshnessPolicy==='deadline_and_change';
    const projection=deriveInventory(state,{...config,now,eventTracked});
    const proofIds=new Set([...Object.values(projection.items).map(i=>i.source.frameId),...projection.pages.map(p=>p.frameId)]);
    if(projection.capacity.frameId)proofIds.add(projection.capacity.frameId);
    for(const frameId of proofIds)reviewed(state,source,frameId);
    const effects=record.effects.map(saved=>{
      const actual=effectFromAction(state,source,saved.actionId);
      if(sha(actual)!==sha(saved))fail('INVENTORY_EFFECT_SOURCE_CHANGED');return actual;
    }).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.sequence-b.sequence);
    for(const effect of effects){
      // Retain immutable accounting history, but an invalidated old result must
      // not seed missing stock or restore capacity after an external change.
      if(state.observationInvalidation&&effect.sequence<=state.observationInvalidation.sequence){
        projection.appliedActions.push(effect.actionId);continue;
      }
      for(const itemId of effect.invalidatedItems??[]){
        const item=projection.items[itemId];
        if(item&&(Date.parse(item.observedAt)<Date.parse(effect.observedAt)||
            Date.parse(item.observedAt)===Date.parse(effect.observedAt)&&item.source.frameId!==effect.frameId))
          Object.assign(item,{status:'effect_unobserved',fresh:false});
      }
      for(const delta of effect.deltas){
        const item=projection.items[delta.itemId];
        if(item?.status==='invalidated')continue;
        const deltaTime=Date.parse(effect.observedAt),stockTime=Date.parse(item?.observedAt??'');
        if(!Number.isFinite(deltaTime)||deltaTime>now)fail('INVENTORY_EFFECT_TIME_INVALID');
        if(stockTime>deltaTime)continue; // A newer observation already includes the effect.
        if(!item||item.status!=='confirmed'){
          // An explicit observed before/after effect can seed partial stock.
          projection.items[delta.itemId]={itemId:delta.itemId,quantity:delta.after,observedAt:effect.observedAt,
            ...(eventTracked?{validity:{untilChange:true}}:{}),status:'confirmed',fresh:fresh(effect.observedAt,now,eventTracked?null:config.maxAgeMs),
            source:{frameId:effect.frameId,evidenceHash:effect.evidenceHash,epoch:effect.epoch,sequence:effect.sequence,actionId:effect.actionId}};
          continue;
        }
        if(stockTime===deltaTime){if(item.source.frameId!==effect.frameId||item.quantity!==delta.after)fail('INVENTORY_EFFECT_CONFLICT');continue;}
        if(item.quantity!==delta.before)fail('INVENTORY_EFFECT_CONFLICT');
        Object.assign(item,{quantity:delta.after,observedAt:effect.observedAt,fresh:fresh(effect.observedAt,now,eventTracked?null:config.maxAgeMs),
          source:{frameId:effect.frameId,evidenceHash:effect.evidenceHash,epoch:effect.epoch,sequence:effect.sequence,actionId:effect.actionId}});
      }
      projection.appliedActions.push(effect.actionId);
      if(!effect.inventoryUnchanged&&!projection.capacity.frameIds.includes(effect.frameId)&&(!projection.capacity.frameIds.length||projection.capacity.frameIds.some(frameId=>
          Date.parse(state.frames[frameId]?.observedAt??'')<=Date.parse(effect.observedAt))))
        projection.capacity=advanceCapacity(projection.capacity,effect,{now,maxAgeMs:config.maxAgeMs,eventTracked});
    }
    // A verified management result missing numeric accounting cannot leave the
    // old barn stock available for another order. Hold until the effect is
    // ingested or newer reviewed stock covers it; never subtract request quantities.
    for(const action of Object.values(state.actions??{})){
      if(action.status==='verified'&&action.target?.management?.source==='mayors_cup_first_claim'&&
        action.resultProof?.rewardObservation?.kind==='mayors_cup_open_ready'&&action.resultProof?.rewardObservation?.rewardAccounting==='not_opened')continue;
      if(action.management===true&&action.target?.kind==='claim_mayors_cup_reward'&&
          !auditedCupNoDispatch(action)&&
          !(action.status==='rejected_before_input'&&action.inputAttempted===false)&&
          (action.inputReservedAt||['issued','captured','unknown','verified'].includes(action.status))){
        // Preserve old quantities as unconfirmed; newer displayed owned counts
        // are authoritative. Verified rewards do not block unrelated allocation
        // while their undisclosed numeric accounting remains in action history.
        const result=state.frames[action.resultFrameId],cutoff=result?.sequence??state.frames[action.frameId]?.sequence??Infinity;
        for(const item of Object.values(projection.items))if(!(item.source.sequence>cutoff))
          Object.assign(item,{status:'effect_pending',fresh:false});
        projection.capacity.fresh=false;
        if(action.status!=='verified')projection.holdReasons.push('INVENTORY_EFFECT_REVIEW_REQUIRED');
        continue;
      }
      if(action.status!=='verified'||action.management!==true)continue;
      if(['send_train','send_airport'].includes(action.target?.kind))continue; // Already loaded; dispatch changes no stock.
      const receipt=actionEffect(state,action);
      if(receipt?.confirmed===true&&receipt.actionId===action.id&&receipt.frameId===action.resultFrameId&&inventoryUnchangedDeletion(state,action,receipt))continue;
      const frame=state.frames[action.resultFrameId],time=Date.parse(frame?.observedAt??'');
      if(record.effects.some(e=>e.actionId===action.id))continue;
      if(!Number.isFinite(time)||projection.capacity.frameIds.some(fid=>Date.parse(state.frames[fid]?.observedAt??'')<=time))projection.capacity.fresh=false;
      if(action.target?.kind==='claim_daily_bonus'){
        for(const item of Object.values(projection.items))if(!Number.isFinite(time)||
            Date.parse(item.observedAt)<time||Date.parse(item.observedAt)===time&&item.source.frameId!==frame.id)
          Object.assign(item,{status:'effect_pending',fresh:false});
        continue;
      }
      const uncovered=!Number.isFinite(time)||Object.values(projection.items).some(item=>
        Date.parse(item.observedAt)<time||Date.parse(item.observedAt)===time&&item.source.frameId!==frame.id);
      if(uncovered){
        const sourceOrder=state.frames[action.frameId]?.review?.data?.order;
        const scope=action.target?.management?.itemId?[action.target.management.itemId]:
          ['load_train','load_airport','send_helicopter'].includes(action.target?.kind)&&Array.isArray(sourceOrder?.needs)?sourceOrder.needs.map(n=>n.itemId):null;
        if(!scope?.length||scope.some(itemId=>!id(itemId)))projection.holdReasons.push('INVENTORY_EFFECT_REVIEW_REQUIRED');
        else for(const itemId of scope){
          const item=projection.items[itemId];
          if(item&&(!Number.isFinite(time)||Date.parse(item.observedAt)<time||Date.parse(item.observedAt)===time&&item.source.frameId!==frame.id))
            Object.assign(item,{status:'effect_pending',fresh:false});
        }
      }
    }
    projection.holdReasons=[...new Set(projection.holdReasons)];
    const orders=record.orderFrameIds.filter(frameId=>orderDemandCurrent(state,state.frames[frameId])).map(frameId=>orderFromFrame(state,source,frameId,now,config.maxAgeMs,effects,eventTracked));
    const allocation=allocateInventory(projection,orders,{expectedRevision:0,now,maxAgeMs:config.maxAgeMs});
    allocation.projection.revision=record.revision;
    return {...allocation,orders};
  }
  readInputState(state){const record=this.load(state);return {revision:record.revision,accounting:{effects:record.effects}};}
  status(){return this.locked(state=>{
    const record=this.load(state);
    if(inventoryRequiresSync(state,record))return {revision:record.revision,sourceRevision:state.revision,requiresSync:true,executionAllowed:false};
    // Planning status holds the source lock and uses this one state snapshot.
    // Recheck every unique original hash on each call; reuse only decoded geometry.
    // inspectForInput() and commit() retain the full evidence path below.
    return {...clone(record),...this.rebuild(state,record,snapshotEvidenceStore(this.source,state)),requiresSync:false};
  });}
  // Caller already owns source.lock (beginAction's synchronous guard).
  inspectForInput(state,fn){
    const fd=acquireStateLock(this.lockFile);
    try{const record=this.load(state);return fn(this.rebuild(state,record),record);}
    finally{closeSync(fd);unlinkSync(this.lockFile);}
  }
  resetStartupDemand(incarnation){
    if(typeof incarnation!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(incarnation))fail('MONITOR_INCARNATION_REQUIRED');
    return this.locked(state=>{
      let record=this.load(state),marker=state.orderDemandStartup;
      if(marker&&(!sameRootPath(marker.sourceRoot,this.source.root)||marker.sessionId!==state.session.id||
          !sameRootPath(marker.inventoryRoot,this.root)))fail('ORDER_STARTUP_PAIR_MISMATCH');
      if(marker?.completed?.[incarnation])return {duplicate:true,cutoffSequence:marker.cutoffSequence};
      if(state.input||hasUnresolvedActions(state.actions??{}))fail('INPUT_UNRESOLVED');
      if(Object.values(state.transportMissions??{}).some(m=>m.waitingActionId||!terminalTransportMission(m))||
          Object.values(state.helicopterRounds??{}).some(r=>!['complete','boundary'].includes(r.status)))fail('MISSION_RECONCILIATION_REQUIRED');
      if(existsSync(join(this.source.root,'capture.lock'))||existsSync(join(this.source.root,'.management','runner.lock'))||
          existsSync(join(this.source.root,'helicopter-runner.lock')))fail('STARTUP_OWNER_NOT_SETTLED');
      const saveSource=()=>{state.revision++;this.source.save(state);};
      const finish=()=>{
        const pending=marker.pending,mutationId='startup-demand:'+pending.incarnation,requestHash=sha({mutationId,cutoffSequence:pending.cutoffSequence,inventoryRoot:marker.inventoryRoot,sessionId:marker.sessionId});
        const prior=findInventoryOperation(this.root,record,mutationId);
        if(prior&&prior.requestHash!==requestHash)fail('MUTATION_ID_REUSED');
        if(!prior){
          const clearedOrderFrameIds=[...record.orderFrameIds];
          record=clone(record);record.orderFrameIds=record.orderFrameIds.filter(id=>orderDemandCurrent(state,state.frames[id]));
          record.revision++;record.sourceRevision=state.revision;record.sourceFingerprint=inventorySourceFingerprint(state);
          record.sourceManagementHash=sha(stable(state.session?.management??null));Object.assign(record,this.rebuild(state,record));
          record.operations.push({mutationId,requestHash,revision:record.revision,
            orderDemandReset:{cutoffSequence:pending.cutoffSequence,clearedOrderFrameIds,remainingOrderFrameIds:[...record.orderFrameIds]}});record.updatedAt=new Date(this.clock()).toISOString();
          checkpointInventoryOperations(this.root,record);
          this.save(this.file,{version:VERSION,checksum:sha(record),record});
        }
        marker.completed[pending.incarnation]={cutoffSequence:pending.cutoffSequence,inventoryRevision:prior?.revision??record.revision};
        marker.pending=null;saveSource();
      };
      // Finish a durable interrupted transaction before beginning this process's
      // boundary. An existing inventory receipt is never applied twice.
      if(marker?.pending)finish();
      if(marker?.completed?.[incarnation])return {duplicate:true,cutoffSequence:marker.cutoffSequence};
      marker??={sourceRoot:this.source.root,sessionId:state.session.id,inventoryRoot:this.root,completed:{}};
      marker.cutoffSequence=state.sequence;marker.pending={incarnation,cutoffSequence:state.sequence};state.orderDemandStartup=marker;
      saveSource();finish();return {duplicate:false,cutoffSequence:marker.cutoffSequence};
    });
  }
  commit(op,request,{beforeCommit=null}={}){
    if(!['init','reserve','sync','release','apply_action','account_action'].includes(op)||!id(request?.mutationId))fail('INVENTORY_OPERATION_INVALID');
    const requestHash=sha({op,request});
    return this.locked(state=>{
      let record=existsSync(this.file)?this.load(state):null;
      const previous=record;
      const old=findInventoryOperation(this.root,record,request.mutationId);
      if(old){if(old.requestHash!==requestHash)fail('MUTATION_ID_REUSED');return {duplicate:true,committedRevision:old.revision,currentRevision:record.revision,executionAllowed:false};}
      if(!integer(request.expectedSourceRevision)||state.revision!==request.expectedSourceRevision)fail('SOURCE_REVISION_CONFLICT');
      if(beforeCommit){
        const checked=beforeCommit(state,record);
        if(checked&&typeof checked.then==='function')fail('ASYNC_INVENTORY_GUARD_UNSUPPORTED');
      }
      if(op==='init'){
        if(record)fail('INVENTORY_ALREADY_INITIALIZED');
        const withBarn=request.snapshotId!==undefined||request.visitIds!==undefined;
        if(withBarn&&(!id(request.snapshotId)||!Array.isArray(request.visitIds)||!request.visitIds.length||!request.visitIds.every(id)))fail('INVENTORY_CONFIG_INVALID');
        const maxAgeMs=request.maxAgeMs??300000;
        if(!integer(maxAgeMs)||maxAgeMs<1||maxAgeMs>300000)fail('INVENTORY_FRESHNESS_INVALID');
        record={schema:1,revision:0,sourceRoot:this.source.root,sourceSessionId:state.session.id,sourceRevision:state.revision,
          config:{...(withBarn?{snapshotId:request.snapshotId,visitIds:clone(request.visitIds)}:{}),maxAgeMs,freshnessPolicy:'deadline_and_change'},orderFrameIds:[],effects:[],operations:[],executionAllowed:false};
      }else{
        if(!record)fail('INVENTORY_NOT_INITIALIZED');
        if(!integer(request.expectedRevision)||request.expectedRevision!==record.revision)fail('INVENTORY_REVISION_CONFLICT');
        record=clone(record);
      }
      if(['init','reserve','sync','account_action'].includes(op)&&request.orderFrameIds!==undefined){
        if(!Array.isArray(request.orderFrameIds)||!request.orderFrameIds.every(id))fail('ORDER_FRAME_IDS_INVALID');
        const refs=op==='reserve'?[...record.orderFrameIds,...request.orderFrameIds]:request.orderFrameIds;
        record.orderFrameIds=[...new Set(refs)].filter(fid=>orderDemandCurrent(state,state.frames[fid]));if(record.orderFrameIds.length>100)fail('ORDERS_INVALID');
      }
      if(op==='sync'&&(request.snapshotId!==undefined||request.visitIds!==undefined)){
        if(!id(request.snapshotId)||!Array.isArray(request.visitIds)||!request.visitIds.length||!request.visitIds.every(id))fail('INVENTORY_CONFIG_INVALID');
        record.config={...record.config,snapshotId:request.snapshotId,visitIds:clone(request.visitIds)};
      }
      if(op==='release'){
        if(!Array.isArray(request.orderIds)||!request.orderIds.every(id))fail('ORDER_IDS_INVALID');
        record.orderFrameIds=record.orderFrameIds.filter(frameId=>!request.orderIds.includes(state.frames[frameId]?.review?.data?.order?.orderId));
      }
      if(['apply_action','account_action'].includes(op)){
        if(!id(request.actionId))fail('ACTION_ID_INVALID');
        if(!record.effects.some(e=>e.actionId===request.actionId)){
          const effect=effectFromAction(state,this.source,request.actionId);
          if(!fresh(effect.observedAt,this.clock(),record.config.freshnessPolicy==='deadline_and_change'?null:record.config.maxAgeMs))fail('INVENTORY_EFFECT_STALE');
          record.effects.push(effect);
        }
      }
      const sourceManagementHash=sha(stable(state.session?.management??null));
      if(op==='sync'&&!inventoryRequiresSync(state,previous)&&previous.sourceManagementHash===sourceManagementHash&&
          sha(stable(record.config))===sha(stable(previous.config))&&
          sha(record.orderFrameIds)===sha(previous.orderFrameIds)){
        // A no-op is still a verified source-to-inventory transaction: rebuild
        // under both locks so corrupt originals/effects and elapsed deadlines
        // cannot hide behind unchanged quantities or a matching fingerprint.
        const rebuilt=this.rebuild(state,record);
        if(sha(stable([projectionFacts(rebuilt.projection),rebuilt.evaluations,rebuilt.orders]))===
            sha(stable([projectionFacts(previous.projection),previous.evaluations,previous.orders])))
          return {duplicate:false,unchanged:true,...clone(record),...rebuilt,requiresSync:false};
      }
      record.revision++;record.sourceRevision=state.revision;record.sourceFingerprint=inventorySourceFingerprint(state);
      record.sourceManagementHash=sourceManagementHash;
      Object.assign(record,this.rebuild(state,record));
      record.operations.push({mutationId:request.mutationId,requestHash,revision:record.revision});
      record.updatedAt=new Date(this.clock()).toISOString();
      checkpointInventoryOperations(this.root,record);
      this.save(this.file,{version:VERSION,checksum:sha(record),record});
      return {duplicate:false,...clone(record)};
    });
  }
}
