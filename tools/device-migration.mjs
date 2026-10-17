import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {deviceConfig,providerOf} from './device.mjs';
import {invalidateMarket} from './mumu-market-state.mjs';

// A device migration retains history and approval, but old observations cannot authorize new work.
export function migrateDevice(store,{source,migrationId,expectedRevision,config,reason}={}){
  if(source!=='explicit_user'||!/^device-[a-z0-9-]{1,70}$/.test(migrationId??'')||!Number.isSafeInteger(expectedRevision)||!reason?.trim())throw Error('DEVICE_MIGRATION_REQUEST_INVALID');
  const next=deviceConfig(config);
  if(!['google_play_windows','android_adb'].includes(next.provider))throw Error('DEVICE_MIGRATION_PROVIDER_UNSUPPORTED');
  let changed=false;
  return store.transact(s=>{
    const previous=s.deviceMigrations?.find(m=>m.id===migrationId);
    if(previous){if(JSON.stringify(previous.to)!==JSON.stringify(next))throw Error('DEVICE_MIGRATION_ID_COLLISION');return previous;}
    if(s.revision!==expectedRevision)throw Error('SOURCE_REVISION_CHANGED');
    if(!s.stopCapture||!s.stopReader)throw Error('DEVICE_MIGRATION_REQUIRES_STOPS');
    if(s.input||hasUnresolvedActions(s.actions??{}))throw Error('INPUT_UNRESOLVED');
    for(const path of ['capture.lock','helicopter-runner.lock','.management/runner.lock'])if(existsSync(join(store.root,path)))throw Error('DEVICE_MIGRATION_OWNER_ACTIVE');
    const from={provider:providerOf(s.session),serial:s.session.serial,packageName:s.session.packageName,executable:s.session.executable,
      windowsTarget:s.session.windowsTarget,windowsBridge:s.session.windowsBridge,windowsBridgeHash:s.session.windowsBridgeHash,
      windowsCaptureSize:s.session.windowsCaptureSize,windowsViewport:s.session.windowsViewport,adbTarget:s.session.adbTarget,adbExecutableHash:s.session.adbExecutableHash};
    for(const key of ['adbTarget','adbExecutableHash','provider','serial','packageName','executable','windowsTarget','windowsBridge','windowsBridgeHash','windowsCaptureSize','windowsViewport','width','height'])delete s.session[key];
    Object.assign(s.session,next);
    s.observationInvalidation={sequence:s.sequence,at:new Date(store.clock()).toISOString(),reason};
    s.observationWait=null;s.observationRefresh=null;s.latestFrameId=null;s.latestCandidateFrameId=null;s.captureError=null;
    s.scene={id:migrationId,kind:'unknown',entityId:null,epoch:s.scene.epoch+1,required:true,roi:null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
    if(s.marketView)invalidateMarket(s,'device_migration');
    s.visits[migrationId]={...s.scene,startedAt:new Date(store.clock()).toISOString(),status:'awaiting_capture',frameId:null};
    const record={id:migrationId,source,reason,at:new Date(store.clock()).toISOString(),from,to:next,sourceRevision:expectedRevision,stopsPreserved:true,inputIssued:false};
    (s.deviceMigrations??=[]).push(record);changed=true;return record;
  },{writeWhen:()=>changed});
}
