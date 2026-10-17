import {validAdbNoInputProof} from '../android-adb-device.mjs';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {beginActionTransition,finishActionTransition} from '../mumu-action-transitions.mjs';
import {assertInputSettled,isUnresolvedAction,terminalTransportMission} from '../mumu-input-state.mjs';
import {inputGeometry,commandForTarget,resolvePercentageCommand} from '../percentage-coordinates.mjs';
import {validWindowsNoInputProof,validWindowsAdapterNoInputProof} from '../windows-device.mjs';
import {validateIntent} from './actions.mjs';
import {DEALER_COOLDOWN_MS} from './dealer.mjs';
import {visionProof} from './geometry.mjs';
import {sha} from './client.mjs';
import {routeTarget} from './order-route.mjs';
import {scrollSwipe} from './market-scroll.mjs';

export function captureOwner(store){
  const owner=JSON.parse(readFileSync(join(store.root,'capture.lock'),'utf8'));
  if(owner.pid!==process.pid||typeof owner.token!=='string'||!owner.token)throw Error('CAPTURE_PRODUCER_NOT_OWNED');return owner;
}
export function somTargetBox(vision,intent){
  if(intent.kind!=='som_select')return intent.box;
  if(intent.route){const target=routeTarget(vision,intent);if(!target)throw Error('SOM_SELECTION_GEOMETRY_REQUIRED');return target;}
  const pins=(vision.pins??[]).filter(p=>p.color===intent.color&&['x','y','width','height'].every(k=>p.box?.[k]===intent.box?.[k]));
  const b=pins.length===1?pins[0].visualBox:null;
  if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.width<10||b.height<10)throw Error('SOM_SELECTION_GEOMETRY_REQUIRED');
  // A narrowing tip can be covered by the next marker in a vertical stack.
  // Click inside this frame's marker body, retaining its tip as the identity
  // anchor used by selection/result checks. Percentage conversion stays below.
  return {x:Math.round(b.x+b.width*.5)-5,y:Math.round(b.y+b.height*.5)-5,width:10,height:10};
}
export function somGuard(store,state,{owner,pending=null,settling=null,signal}={}){
  if(signal?.aborted||state.stopCapture||state.stopReader)throw Error('SESSION_STOPPED');
  if(state.settings.workflowMode!=='som'||!['google_play_windows','android_adb'].includes(state.session.provider))throw Error('SOM_MODE_REQUIRED');
  if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')throw Error('MANAGEMENT_APPROVAL_REQUIRED');
  if(state.session.management.policy?.tcash!=='forbidden')throw Error('SOM_COIN_ONLY_POLICY_REQUIRED');
  if(captureOwner(store).token!==owner?.token)throw Error('CAPTURE_PRODUCER_NOT_OWNED');
  if(existsSync(join(store.root,'.management','runner.lock'))||existsSync(join(store.root,'helicopter-runner.lock')))throw Error('FOREIGN_INPUT_OWNER');
  if(state.orderDemandStartup?.pending)throw Error('ORDER_STARTUP_RESET_PENDING');
  if(Object.values(state.helicopterRounds??{}).some(r=>!['boundary','complete'].includes(r.status))||Object.values(state.transportMissions??{}).some(m=>!terminalTransportMission(m)))throw Error('DELIVERY_SETTLED_BOUNDARY_REQUIRED');
  if(settling){
    if(state.input!==settling||!['issued','captured'].includes(state.actions[settling]?.status)||Object.entries(state.actions).some(([id,a])=>id!==settling&&isUnresolvedAction(a)))throw Error('INPUT_UNRESOLVED');
  }else assertInputSettled(state,{pendingActionId:pending});
}
export async function issueSomInput(store,frame,vision,intent,{device,owner,signal}={}){
  const state=store.load();somGuard(store,state,{owner,signal});
  const dealerAllowed=s=>{if(['som_dealer_open','som_dealer_buy'].includes(intent.kind)&&store.clock()<(s.somDealerSearchAfter??0))throw Error('SOM_DEALER_COOLDOWN');};
  dealerAllowed(state);
  if(state.latestFrameId!==frame.id||state.scene.epoch!==frame.epoch||state.observationInvalidation?.sequence>=frame.sequence||
    state.frames[frame.id]?.evidenceHash!==frame.evidenceHash||!validateIntent(vision,intent,store.clock()))throw Error('SOM_CURRENT_TARGET_REQUIRED');
  if(intent.route){
    const source=intent.route.source,original=state.frames[source?.frameId];
    if(!original||original.evidenceHash!==source.evidenceHash||original.provider!==frame.provider||original.serial!==frame.serial||
      original.width!==frame.width||original.height!==frame.height)throw Error('SOM_SELECTION_SOURCE_REQUIRED');
  }
  const targetBox=somTargetBox(vision,intent);
  const actionId='som-'+randomUUID(),target={id:actionId,kind:intent.kind,type:intent.kind==='som_scroll'?'swipe':'tap',box:targetBox,som:intent};
  const swipe=intent.kind==='som_scroll'?scrollSwipe(intent):null;
  const {command,coordinates}=commandForTarget(target,swipe,inputGeometry(state.session,frame));
  const signature=visionProof(vision),sessionHash=sha(state.session);
  const inputSequence=intent.kind==='som_send'?{kind:'som_helicopter_send_skip',delayMs:100,clickCount:2}:null;
  if(inputSequence&&intent.next!=='helicopter')throw Error('SOM_SEND_SEQUENCE_SCOPE_INVALID');
  await store.retry(()=>store.transact(s=>{
    somGuard(store,s,{owner,signal});if(s.latestFrameId!==frame.id||s.scene.epoch!==frame.epoch)throw Error('SOM_FRAME_CHANGED');
    s.frames[frame.id].required=true;
    if(intent.route)s.frames[intent.route.source.frameId].required=true;
    beginActionTransition(s,{actionId,requestDigest:sha({frameId:frame.id,intent,coordinates}),frameId:frame.id,targetId:target.id,target,command,
      percentageCommand:coordinates,nextVisit:{visitId:actionId+'-result',kind:intent.next},management:['som_buy','som_send','som_delete','som_claim','som_barn_sell','som_dealer_buy'].includes(intent.kind),frame},store.clock);
    s.actions[actionId].somProof={schema:1,frameId:frame.id,evidenceHash:frame.evidenceHash,profileHash:vision.profileHash,
      visionHash:signature,ownerToken:owner.token,sessionHash,inputMode:'source_observation'};
    if(inputSequence)s.actions[actionId].inputSequence={...inputSequence,ownerPid:owner.pid};
  }));
  let inputAttempted=false;
  try{
    // The user's single-observation path uses the decision frame directly.
    // Preserve its original capture time; do not invent a new preflight image.
    const beforeInput=()=>{
      const s=store.load();somGuard(store,s,{owner,pending:actionId,signal});dealerAllowed(s);const a=s.actions[actionId];
      if(!validateIntent(vision,intent,store.clock()))throw Error('SOM_CURRENT_TARGET_REQUIRED');
      if(sha(s.session)!==sessionHash||s.scene.epoch!==a.epoch||s.latestFrameId!==frame.id||s.observationInvalidation?.sequence>=frame.sequence||
        sha(a.target)!==sha(target)||sha(a.somProof)!==sha({schema:1,frameId:frame.id,evidenceHash:frame.evidenceHash,profileHash:vision.profileHash,visionHash:signature,ownerToken:owner.token,sessionHash,inputMode:'source_observation'})||
        s.frames[frame.id]?.evidenceHash!==frame.evidenceHash)throw Error('SOM_INPUT_CONTEXT_CHANGED');
      if(sha(a.inputSequence??null)!==sha(inputSequence?{...inputSequence,ownerPid:owner.pid}:null))throw Error('SOM_INPUT_SEQUENCE_CHANGED');
      resolvePercentageCommand(a.percentageCommand,inputGeometry(s.session,frame),a.command);
    };
    beforeInput();store.actionStage(actionId,'inputReservedAt');inputAttempted=true;
    const receipt=await device.navigate(command,{width:frame.width,height:frame.height,beforeInput,coordinates,expected:frame,permit:{statePath:store.file,actionId},signal});
    await store.retry(()=>store.transact(s=>{if(s.input!==actionId||s.actions[actionId].status!=='pending')throw Error('INPUT_UNRESOLVED');s.actions[actionId].deviceReceipt=receipt;}));
    if(intent.kind!=='som_dealer_buy'||receipt.commandIssued!==true)return await store.retry(()=>store.finishAction(actionId));
    // Explicit user policy: a completed dealer tap needs no ON BREAK/result check.
    // 'dispatched' records input completion, never a claimed inventory change.
    return await store.retry(()=>store.transact(s=>{
      if(s.input!==actionId)throw Error('INPUT_UNRESOLVED');
      const a=finishActionTransition(s,actionId,null,true,store.clock);
      s.somDealerSearchAfter=Date.parse(a.issuedAt)+DEALER_COOLDOWN_MS;
      a.status='verified';a.outcome='dispatched';s.input=null;return structuredClone(a);
    }));
  }catch(error){
    if(error.adbInputFailure)store.transact(s=>{s.actions[actionId].adapterInputFailure=error.adbInputFailure;});
    if(validAdbNoInputProof(error,actionId)){inputAttempted=false;store.transact(s=>{s.actions[actionId].adapterRejectionProof=error.adbNoInputProof;});}
    const a=store.load().actions[actionId],p=error.windowsNoInputProof;
    if(validWindowsAdapterNoInputProof(error.windowsAdapterNoInputProof,{actionId,command,bridgeHash:state.session.windowsBridgeHash,error:error.message})){
      store.transact(s=>{s.actions[actionId].adapterRejectionProof=structuredClone(error.windowsAdapterNoInputProof);});inputAttempted=false;
    }
    if(error.windowsInputFailure)store.transact(s=>{s.actions[actionId].nativeInputFailure=error.windowsInputFailure;});
    if(validWindowsNoInputProof(p,{actionId,command,bridgeHash:state.session.windowsBridgeHash,error:error.message,inputReservedAt:a.inputReservedAt})){
      store.transact(s=>{s.actions[actionId].deviceRejectionProof=p;});inputAttempted=false;
    }
    await store.retry(()=>store.finishAction(actionId,error.message,{inputAttempted}));throw error;
  }
}
