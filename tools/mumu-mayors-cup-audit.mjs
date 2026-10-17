import {isUnresolvedAction} from './mumu-input-state.mjs';
// Case-specific operator code-path audit, not a recovered native receipt.
// The pinned tap can throw INPUT_TARGET_OCCLUDED only before SendInput. Do not
// generalize this conclusion to swipes, other errors, binaries or actions.
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {mayorsCupBindingHash} from './mumu-management.mjs';
import './windows-device.mjs';
export const CUP_AUDIT_ID='manager-mayors-cup-claim-20261005-1703';
export const CUP_AUDIT_HASH='018fec9d6b87124175b3808e3dcd75d49f8f43875b115ef1616f48c730b08d7b';
const sourceHash='6fc38044129ef674e42749abe62be7374a681ecfc66b518da8d2d2e0944348eb';
const preflightHash='49d4f4a89ce9646b0ba2c5ab808d54eb79ba8121570129db96a18e51e917a331';
const dllHash='aaf3d12b3cba6fb98481e4258186a67fb91f25b2eadfbee2b2096d27327f1bc3';
const nativeSourceHash='88699808acd202bd4cd234e4caeaf5b24752f7835759e13a570489348f195ee1';
const unresolved=a=>isUnresolvedAction(a);
const hashFile=file=>digest(readFileSync(file));
const fail=code=>{throw Error(code);};
export function auditedCupNoDispatch(a){
  if(a?.id!==CUP_AUDIT_ID||a.status!=='resolved_code_path_audit')return false;
  const p=a.nativeReconciliation;
  if(p?.schema!==1||p.source!=='explicit_user'||p.basis!=='pinned_tap_pre_dispatch_code_path'||p.conclusion!=='operator_code_path_no_dispatch'||
    p.nativeReceiptAvailable!==false||p.originalActionHash!==CUP_AUDIT_HASH||p.nativeDllHash!==dllHash||p.nativeSourceHash!==nativeSourceHash||
    p.sourceHash!==sourceHash||p.preflightHash!==preflightHash||!Number.isFinite(Date.parse(p.at))||
    !/^[a-f0-9]{64}$/.test(p.independentReviewHash??''))return false;
  const original={...a,status:'unknown'};delete original.nativeReconciliation;
  return mayorsCupBindingHash(original)===CUP_AUDIT_HASH;
}
export {assertCupFirstBudget as assertMayorsCupProgramBudget} from './mumu-cup-budget.mjs';
export function reconcileMayorsCupOcclusion(store,{source,expectedRevision,implementationRoot,failureFile,independentReviewHash,safety}={}){
  if(source!=='explicit_user'||!Number.isSafeInteger(expectedRevision)||!implementationRoot||!failureFile||
    !/^[a-f0-9]{64}$/.test(independentReviewHash??''))fail('CUP_AUDIT_AUTHORIZATION_REQUIRED');
  const now=store.clock();
  if(safety?.nativeHelperCount!==0||!Number.isFinite(Date.parse(safety?.observedAt))||
    now-Date.parse(safety.observedAt)<0||now-Date.parse(safety.observedAt)>30000)fail('CUP_AUDIT_FRESH_SAFETY_REQUIRED');
  const pins={
    'apps/TownshipDesktopBridge/Program.cs':nativeSourceHash,
    'apps/TownshipDesktopBridge/Native.cs':'a10480bf095551c6abcb08b65826d7c0e853f72c8f7ab73a31369247dc70ea1b',
    'artifacts/TownshipDesktopBridge/TownshipDesktopBridge.dll':dllHash,
    'artifacts/TownshipDesktopBridge/TownshipDesktopBridge.exe':'82c8533834bdab2ff43e3ff07daf2a918c3d61cb30490ca4aa2081f36359fb9a',
    'tools/windows-device.mjs':'487b54b61aff0eea98738274993832540755cb93bca4bfd17276e2d8ff07e639'};
  for(const [file,hash] of Object.entries(pins))if(hashFile(join(implementationRoot,file))!==hash)fail('CUP_AUDIT_NATIVE_VERSION_CHANGED');
  const failure=JSON.parse(readFileSync(failureFile,'utf8').replace(/^\uFEFF/,''));
  if(failure.ok!==false||failure.error!=='INPUT_TARGET_OCCLUDED')fail('CUP_AUDIT_FAILURE_CHANGED');
  return store.transact(s=>{
    if(s.revision!==expectedRevision)fail('SOURCE_REVISION_CHANGED');
    if(!s.stopCapture||!s.stopReader)fail('RECONCILIATION_REQUIRES_STOPS');
    for(const p of ['capture.lock','helicopter-runner.lock','.management/runner.lock'])
      if(existsSync(join(store.root,p)))fail('RECONCILIATION_OWNER_ACTIVE');
    const a=s.actions[CUP_AUDIT_ID];
    if(s.input!==CUP_AUDIT_ID||mayorsCupBindingHash(a)!==CUP_AUDIT_HASH||a.status!=='unknown'||a.command?.type!=='tap'||
      a.error!=='INPUT_TARGET_OCCLUDED'||a.inputAttempted!==true||a.deviceReceipt||a.resultFrameId||a.resultProof||a.nativeReconciliation||
      s.session.provider!=='google_play_windows'||s.session.windowsBridgeHash!==dllHash||
      Object.values(s.actions).some(x=>x!==a&&unresolved(x))||Object.values(s.transportMissions??{}).some(m=>m.waitingActionId))fail('CUP_AUDIT_INCIDENT_CHANGED');
    const f=store.evidence(a.frameId),p=a.preflightEvidence;
    if(f.frame.evidenceHash!==sourceHash||digest(f.bytes)!==sourceHash||p?.evidenceHash!==preflightHash||hashFile(p.evidenceRef)!==preflightHash||
      a.epoch!==s.scene.epoch||f.frame.epoch+1!==a.epoch)fail('CUP_AUDIT_ORIGINAL_CHANGED');
    const auditFile=join(store.root,'desktop-input',digest(Buffer.from(CUP_AUDIT_ID))+'.json');
    if(existsSync(auditFile)||existsSync(auditFile+'.tmp'))fail('CONFLICTING_DISPATCH_EVIDENCE');
    a.status='resolved_code_path_audit';
    a.nativeReconciliation={schema:1,source,at:new Date(now).toISOString(),basis:'pinned_tap_pre_dispatch_code_path',
      conclusion:'operator_code_path_no_dispatch',nativeReceiptAvailable:false,originalActionHash:CUP_AUDIT_HASH,
      nativeDllHash:dllHash,nativeSourceHash,sourceHash,preflightHash,independentReviewHash};
    if(!auditedCupNoDispatch(a))fail('CUP_AUDIT_PROOF_INVALID');
    s.input=null;s.scene={...s.scene,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};s.latestCandidateFrameId=null;
    return structuredClone(a);
  });
}
