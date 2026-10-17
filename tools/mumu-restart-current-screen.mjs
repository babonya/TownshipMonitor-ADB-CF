import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {isUnresolvedAction,terminalTransportMission} from './mumu-input-state.mjs';
import {invalidateMarket} from './mumu-market-state.mjs';

import {assertNativeInputIdle,ownerExited} from './mumu-process-owner.mjs';
export {assertNativeInputIdle} from './mumu-process-owner.mjs';
import {recoverExitedLock,recoveryFencePresent} from './mumu-persistence.mjs';
import {recoverAndroidRestart} from './android-adb-restart.mjs';

// Called once per native GUI incarnation, never by Start, status or a running
// delivery callback. Old effects are neither verified, replayed nor accounted.
export function restartCurrentScreen(store,incarnation,{nativeInputIdle=assertNativeInputIdle,processAlive=null,androidRestart=recoverAndroidRestart}={}){
  if(typeof incarnation!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(incarnation))throw Error('MONITOR_INCARNATION_INVALID');
  return store.transact(state=>{
    if(!['google_play_windows','android_adb'].includes(state.session.provider))throw Error('NATIVE_STARTUP_REQUIRED');
    if(state.orderDemandStartup?.completed?.[incarnation])return {reset:false};
    const checkNativeIdle=()=>{if(state.session.provider==='google_play_windows')nativeInputIdle();};
    const exited=owner=>processAlive?Number.isSafeInteger(owner?.pid)&&owner.pid>0&&!!owner.token&&!processAlive(owner.pid):ownerExited(owner);
    checkNativeIdle();
    for(const name of ['.management/runner.lock','helicopter-runner.lock','capture.lock']){
      const file=join(store.root,name);
      if(existsSync(file)||recoveryFencePresent(file)){
        recoverExitedLock(file,{exited,beforeRecover:()=>{store.load();checkNativeIdle();}});
        if(existsSync(file)||recoveryFencePresent(file))throw Error('STARTUP_OWNER_NOT_SETTLED');
      }
    }
    if(state.session.provider==='android_adb')androidRestart(state);
    const at=new Date(store.clock()).toISOString(),actionIds=[];
    for(const action of Object.values(state.actions??{}))if(isUnresolvedAction(action)){
      action.restartSupersession={incarnation,at,previousStatus:action.status,outcome:'unconfirmed'};
      action.status='superseded_on_restart';actionIds.push(action.id);
    }
    for(const mission of Object.values(state.transportMissions??{}))if(!terminalTransportMission(mission)||mission.waitingActionId){
      mission.restartSupersession={incarnation,at,previousStatus:mission.status,waitingActionId:mission.waitingActionId??null};
      mission.status='externally_superseded';mission.waitingActionId=null;mission.reason='RESTART_CURRENT_SCREEN';
    }
    // Rounds are temporary work. Boundary means abandoned work, not delivery.
    for(const round of Object.values(state.helicopterRounds??{}))if(!['complete','boundary'].includes(round.status)){
      round.restartSupersession={incarnation,at,previousStatus:round.status};
      round.status='boundary';round.reason='RESTART_CURRENT_SCREEN';
    }
    state.input=null;
    state.observationInvalidation={sequence:state.sequence,at,reason:'restart_current_screen',incarnation};
    state.observationWait=null;state.observationRefresh=null;
    state.latestFrameId=null;state.latestCandidateFrameId=null;state.captureError=null;
    state.scene={id:'restart:'+incarnation,kind:'unknown',entityId:null,epoch:state.scene.epoch+1,
      required:true,roi:null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
    state.visits[state.scene.id]={...state.scene,startedAt:at,status:'awaiting_capture',frameId:null};
    for(const frame of Object.values(state.frames??{}))if(['ready','processing','deferred'].includes(frame.job?.status))
      frame.job={...frame.job,status:'discarded',reason:'RESTART_CURRENT_SCREEN'};
    invalidateMarket(state,'restart_current_screen');
    const marker=state.orderDemandStartup??={sourceRoot:store.root,sessionId:state.session.id,completed:{}};
    marker.cutoffSequence=state.sequence;marker.pending=null;marker.currentIncarnation=incarnation;marker.completed??={};
    marker.completed[incarnation]={cutoffSequence:state.sequence,mode:'current_screen',actionIds};
    return {reset:true,incarnation,cutoffSequence:state.sequence,supersededInputs:actionIds.length};
  },{writeWhen:result=>result.reset});
}
