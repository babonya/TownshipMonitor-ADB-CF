import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAVIGATION_KINDS } from './mumu-store.mjs';
import { MANAGEMENT_KINDS,DISABLED_MANAGEMENT_KINDS,FORBIDDEN_PRODUCTION_KINDS,TRANSPORT_POLICY } from './mumu-management.mjs';
import {validNativeTrainLoad} from './mumu-train-loading-proof.mjs';

// No device commands, implicit approval, resume, or state writes.
export function readiness(store,{requestedKinds=[]}={}) {
  if(!Array.isArray(requestedKinds) || requestedKinds.some(k=>typeof k!=='string'))throw Error('READINESS_REQUEST_INVALID');
  const status=store.status(),supported=[...NAVIGATION_KINDS,...MANAGEMENT_KINDS];
  const missing=requestedKinds.filter(k=>!supported.includes(k));
  const disabled=requestedKinds.filter(k=>[...DISABLED_MANAGEMENT_KINDS,...FORBIDDEN_PRODUCTION_KINDS].includes(k));
  const modules=['adb.mjs','perception.mjs','ocr-file.ps1','mumu-store.mjs','mumu-management.mjs','mumu-cli.mjs','mumu-capture.mjs','mumu-recognize.mjs','mumu-verification.mjs','mumu-operator.mjs','mumu-freshness.mjs','mumu-performance.mjs','mumu-reference.mjs','../reference/mumu-screen-profiles.json','../reference/product-catalog.json'];
  const missingModules=modules.filter(name=>!existsSync(fileURLToPath(new URL(name,import.meta.url))));
  const windows=status.session.provider==='google_play_windows';
  const windowsHelicopter=windows&&status.session.windowsCaptureSize?.width===1114&&status.session.windowsCaptureSize?.height===735;
  const nativeLoad=windows&&status.latestFrame?.review?.targets.some(t=>validNativeTrainLoad(status.latestFrame,t));
  const managementKinds=windows?(windowsHelicopter?['send_helicopter','delete_helicopter','collect_train',...(nativeLoad?['load_train']:[])]:[]):MANAGEMENT_KINDS.filter(k=>![...DISABLED_MANAGEMENT_KINDS,...FORBIDDEN_PRODUCTION_KINDS].includes(k));
  const adbExecutableExists=windows?false:existsSync(status.session.executable);
  const deviceExecutableExists=windows?existsSync(status.session.windowsBridge):adbExecutableExists;
  const wantsManagement=requestedKinds.some(k=>MANAGEMENT_KINDS.includes(k));
  return {schema:1,sessionId:status.session.id,mode:status.session.mode,policy:structuredClone(TRANSPORT_POLICY),
    capabilities:{navigation:NAVIGATION_KINDS,management:managementKinds,disabledManagement:DISABLED_MANAGEMENT_KINDS},permissions:status.permissions,
    implementationReady:missing.length===0 && missingModules.length===0 && deviceExecutableExists,
    inputReady:missing.length===0 && disabled.length===0 && missingModules.length===0 && deviceExecutableExists && status.permissions.navigationAllowed && (!wantsManagement || status.permissions.managementAllowed&&requestedKinds.filter(k=>MANAGEMENT_KINDS.includes(k)).every(k=>managementKinds.includes(k))),
    observationRefresh:status.observationRefresh,observationWait:status.observationWait,
    checks:{missingKinds:missing,disabledKinds:disabled,missingModules,adbExecutableExists,deviceExecutableExists,provider:status.session.provider??'mumu_adb',deviceChecked:false,frameMaxAgeMs:null,frameValidity:'deadline_and_change',preflightRequired:true,postInputReviewRequired:true},
    next:windows&&wantsManagement&&requestedKinds.filter(k=>MANAGEMENT_KINDS.includes(k)).some(k=>!managementKinds.includes(k))?'GOOGLE_PLAY_PROFILE_REQUIRED':missing.length?'IMPLEMENT_SUPPORTED_ACTIONS':!status.permissions.navigationAllowed?status.permissions.blockedBy:disabled.length?'MANAGEMENT_DEALER_DISABLED':wantsManagement && !status.permissions.managementAuthorized?'EXPLICIT_MANAGEMENT_APPROVAL_REQUIRED':'PREPARE_CURRENT_REVIEW'};
}
