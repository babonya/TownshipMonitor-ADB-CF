import {transportEnabled} from './mumu-delivery-scope.mjs';
// Ownership and policy boundary shared by the single awaited coordinator.
import {hasUnresolvedActions,terminalTransportMission} from './mumu-input-state.mjs';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sameRootPath} from './mumu-path-identity.mjs';
import {digest} from './adb.mjs';
import {assertOrderStartupComplete} from './mumu-order-demand.mjs';
import {readContinuity,continuityRelease} from './mumu-continuity.mjs';
import {HELICOPTER_ROUND_END_CONDITION} from './mumu-helicopter-loop.mjs';
import {ownsDeliveryInput} from './mumu-delivery-input-owner.mjs';
import {readTransportState} from './mumu-transport-state.mjs';
import {verifiedTransportMissionPlan} from './mumu-automatic.mjs';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));
const unresolved=state=>state.input||hasUnresolvedActions(state.actions??{});
const CONTEXT_SCENES=Object.freeze({
  helicopter:['helicopter','unknown'],
  train:['train','unknown'],airport:['airport','unknown'],town:['town','unknown'],
  market:['market','town','barn','unknown'],
  navigation:['town','helicopter','train','airport','unknown'],
  cup:['mayors_cup_result','town','helicopter','train','airport','unknown'],
  event:null
});

export function assertDeliveryContext(coordinator,{context='helicopter',phase='observe',allowReconciliation=false}={}){
    const allowedScenes=CONTEXT_SCENES[context];
    if(!Object.hasOwn(CONTEXT_SCENES,context)||!['observe','owned-input','accounting'].includes(phase))throw Error('DELIVERY_CONTEXT_INVALID');
    const state=coordinator.store.load();
    assertOrderStartupComplete(state);
    if(coordinator.signal?.aborted||state.stopCapture||state.stopReader)throw Error('SESSION_STOPPED');
    if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')throw Error('MANAGEMENT_APPROVAL_REQUIRED');
    if(['train','airport'].includes(context)&&!transportEnabled(state,context))throw Error('TRANSPORT_DISABLED_HELICOPTER_ONLY');
    const ownedInput=ownsDeliveryInput(coordinator,state,{context,phase});
    if(unresolved(state)&&!ownedInput)throw Error('INPUT_UNRESOLVED');
    if(!coordinator.currentMode&&context!=='market'&&(!coordinator.inventory||!existsSync(coordinator.inventory.file)))throw Error('EXISTING_INVENTORY_REQUIRED');
    const file=join(coordinator.store.root,'capture.lock');let owner;
    try{owner=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('CAPTURE_OWNERSHIP_REQUIRED');}
    if(owner.pid!==process.pid||typeof owner.token!=='string'||!owner.token)throw Error('CAPTURE_PRODUCER_NOT_OWNED');
    if(coordinator.owner&&sha(owner)!==sha(coordinator.owner))throw Error('CAPTURE_PRODUCER_NOT_OWNED');
    coordinator.owner??=owner;
    if(existsSync(join(coordinator.store.root,'.management','runner.lock'))||existsSync(join(coordinator.store.root,'helicopter-runner.lock')))throw Error('DELIVERY_RUNNER_NOT_OWNED');
    if(coordinator.currentMode){
      if(Object.values(state.helicopterRounds??{}).some(r=>!['boundary','complete'].includes(r.status)))throw Error('ROUND_RECONCILIATION_REQUIRED');
      const owned=new Set([readTransportState(coordinator,'train').plan?.steps[0]?.actionId,readTransportState(coordinator,'airport').plan?.steps[0]?.actionId,readTransportState(coordinator,'helicopter').plan?.steps[0]?.actionId].filter(Boolean));
      for(const [id,m] of Object.entries(state.transportMissions??{}))if(!terminalTransportMission(m)&&!owned.has(m.waitingActionId??id)){
        if(phase==='accounting'&&m.waitingActionId&&state.actions[m.waitingActionId]?.status==='verified')verifiedTransportMissionPlan(state,id,coordinator.store.clock());
        else throw Error('MISSION_RECONCILIATION_REQUIRED');
      }
      if(allowedScenes&&!allowedScenes.includes(state.scene.kind))throw Error('DELIVERY_SCENE_REQUIRED');
      return {state,continuity:{status:'not_started',currentRoundId:null,receipts:[]}};
    }
    if(context==='market'){
      if(Object.values(state.transportMissions??{}).some(m=>m.waitingActionId)||
        Object.values(state.helicopterRounds??{}).some(r=>!['boundary','complete'].includes(r.status)))throw Error('MARKET_SETTLED_TRANSPORT_BOUNDARY_REQUIRED');
      if(!allowedScenes.includes(state.scene.kind))throw Error('MARKET_CONTEXT_REQUIRED');
      return {state,continuity:readContinuity(coordinator.store)};
    }
    const continuity=readContinuity(coordinator.store),ownedRound=continuity.currentRoundId;
    if(continuity.status!=='not_started'&&(continuity.releaseId!==continuityRelease()||
        !sameRootPath(continuity.inventoryRoot,coordinator.inventory.root)||continuity.policyHash!==sha(state.session.management)||
        continuity.endCondition!==HELICOPTER_ROUND_END_CONDITION))throw Error('CONTINUITY_CONFIG_CHANGED');
    if(!allowReconciliation&&Object.entries(state.helicopterRounds??{}).some(([id,r])=>id!==ownedRound&&!['boundary','complete'].includes(r.status)))throw Error('ROUND_RECONCILIATION_REQUIRED');
    const ownedActions=new Set(state.helicopterRounds?.[ownedRound]?.actionIds??[]);
    if(context==='train'&&readTransportState(coordinator,'train').plan&&readTransportState(coordinator,'train').actionId===readTransportState(coordinator,'train').plan.steps[0].actionId)ownedActions.add(readTransportState(coordinator,'train').actionId);
    if(context==='airport'&&readTransportState(coordinator,'airport').plan&&readTransportState(coordinator,'airport').actionId===readTransportState(coordinator,'airport').plan.steps[0].actionId)ownedActions.add(readTransportState(coordinator,'airport').actionId);
    if(phase==='accounting')for(const [id,m]of Object.entries(state.transportMissions??{}))if(m.waitingActionId){
      verifiedTransportMissionPlan(state,id,coordinator.store.clock());ownedActions.add(m.waitingActionId);
    }
    if(Object.values(state.transportMissions??{}).some(m=>m.waitingActionId&&!ownedActions.has(m.waitingActionId)))throw Error('MISSION_RECONCILIATION_REQUIRED');
    if(allowedScenes&&!allowedScenes.includes(state.scene.kind))throw Error('HELICOPTER_CONTEXT_REQUIRED');
    return {state,continuity};
  }
