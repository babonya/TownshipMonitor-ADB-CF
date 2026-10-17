import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {readContinuity} from './mumu-continuity.mjs';
import {deliveryHold} from './mumu-delivery-state.mjs';
import {helicopterReconciliationSummary} from './mumu-helicopter-loop.mjs';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));
function readMonitorDeliveryRecord(store){
  try{
    const state=store.load(),reconciliation=helicopterReconciliationSummary(state),file=join(store.root,'.monitor','delivery.json');
    if(existsSync(file)){
      const envelope=JSON.parse(readFileSync(file,'utf8')),record=envelope.record;
      if(envelope.schema!==1||envelope.checksum!==sha(record)||record.sessionId!==state.session.id||
          record.status?.executionAllowed!==false)throw Error('MONITOR_DELIVERY_STATUS_INTEGRITY_ERROR');
      if(state.orderDemandStartup?.currentIncarnation&&record.startupIncarnation!==state.orderDemandStartup.currentIncarnation)
        return {phase:'not_started',running:false,reason:state.stopCapture||state.stopReader?'SESSION_STOPPED':null,reconciliation,executionAllowed:false};
      if(state.stopCapture||state.stopReader)return {...record.status,phase:'hold',reason:'SESSION_STOPPED',running:false,observationSchedule:null,reconciliation,executionAllowed:false};
      let owner;try{owner=JSON.parse(readFileSync(join(store.root,'capture.lock'),'utf8'));}catch{}
      if(owner?.pid===record.ownerPid&&typeof record.ownerToken==='string'&&record.ownerToken&&
          owner.token===record.ownerToken&&store.captureProducerAlive())return {...record.status,reconciliation,executionAllowed:false};
      if(record.status.running||record.status.observationSchedule||record.status.phase==='minigame_requesting')return {...record.status,phase:'observer_unavailable',running:false,reason:'DELIVERY_OWNER_NOT_RUNNING',observationSchedule:null,reconciliation,executionAllowed:false};
      return {...record.status,reconciliation,executionAllowed:false};
    }
    if(['google_play_windows','android_adb'].includes(state.session.provider))return {phase:'not_started',running:false,reason:state.stopCapture||state.stopReader?'SESSION_STOPPED':null,reconciliation,executionAllowed:false};
    const record=readContinuity(store);
    if(state.stopCapture||state.stopReader)return {phase:'hold',reason:'SESSION_STOPPED',running:false,reconciliation,executionAllowed:false};
    return {phase:record.status==='not_started'?'not_started':record.status==='hold'?'hold':'idle',running:false,
      reason:record.reason??null,managementId:record.managementId??null,currentRoundId:record.currentRoundId??null,
      lastRoundId:record.receipts?.at(-1)?.roundId??null,completedRounds:record.receipts?.length??0,reconciliation,executionAllowed:false};
  }catch(error){return {phase:'hold',running:false,reason:error.message,executionAllowed:false};}
}

export function readMonitorDelivery(store){
  const record=readMonitorDeliveryRecord(store);return {...record,hold:deliveryHold(record.reason)};
}
