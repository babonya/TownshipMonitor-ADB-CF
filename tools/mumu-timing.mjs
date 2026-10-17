import {endpointCaptureProof,matchesEndpointCapture} from './android-market-drag.mjs';
import {somFirstResultMs} from './som/action-policy.mjs';
// Shared cadence for observation and post-input result evidence. Preflight
// screenshots remain immediate; elapsed time alone never verifies an action.
export const OBSERVATION_INTERVAL_MS=3000;
export const POST_INPUT_DELAY_MS=1000;
export const CAPTURE_POLL_MS=100;
const defaultSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// These are first-result observation floors, never action-success evidence.
export function postInputDelayMs(action){
  if(endpointCaptureProof(action))return 0;
  const target=action?.target;
  if(target?.kind==='barn_sell'&&target.barnNative?.role==='sell')return 100;
  if(action?.somProof)return somFirstResultMs(action);
  return POST_INPUT_DELAY_MS;
}

export function resultCaptureDueAt(action){
  if(!action || action.lifecycle || !['issued','captured'].includes(action.status))return null;
  const issued=Date.parse(action.issuedAt);
  if(!Number.isFinite(issued))throw Error('ACTION_ISSUED_TIME_INVALID');
  return issued+postInputDelayMs(action);
}

// No source lock is held while waiting. Recheck stop flags and the current
// input after each short wait, so a changed action cannot inherit an old timer.
export async function waitForResultCapture(store,{sleep=defaultSleep,signal=null}={}){
  while(true){
    const state=store.load();
    if(state.stopCapture || state.stopReader || signal?.aborted)throw Error('SESSION_STOPPED');
    const due=resultCaptureDueAt(state.actions[state.input]);
    const remaining=due===null?0:due-store.clock();
    if(remaining<=0)return;
    await sleep(Math.min(remaining,CAPTURE_POLL_MS));
  }
}

export function resultCaptureReady(action,evidence){
  const due=resultCaptureDueAt(action);
  if(evidence?.endpointCapture)return due!==null&&matchesEndpointCapture(action,evidence);
  const started=Date.parse(evidence?.captureStartedAt??evidence?.startedAt);
  return due===null||(Number.isFinite(started)&&started>=due);
}
