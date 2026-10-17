import {WindowsBridgeCall,BoundedBridgeStderr} from './windows-bridge-lifecycle.mjs';
import {resolveWindowsInputCommand,windowsInputArguments,validateIssuedWindowsReceipt,validateWindowsInputSequence,windowsInputEvidence,completedWindowsDragReceipt,completedWindowsSendReceipt} from './windows-input-contract.mjs';
import {spawn} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {digest,decodePng,validateBox} from './adb.mjs';

export const WINDOWS_PROVIDER='google_play_windows';
const fail=reason=>{throw Error(reason);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const targetIdentity=t=>({hwnd:t?.hwnd,pid:t?.pid,processStartedTicks:t?.processStartedTicks,processPath:t?.processPath,title:t?.title});
export const windowsSerial=t=>'win32:'+t.pid+':'+t.hwnd+':'+t.processStartedTicks;
const preDispatchGuards=new Set(['USER_POINTER_ACTIVE','INPUT_TARGET_NOT_FOREGROUND','USER_INPUT_ACTIVE','INPUT_PREFLIGHT_EXPIRED','INPUT_OBSERVATION_EXPIRED','INPUT_OBSERVATION_CHANGED','SESSION_STOPPED']);
const closedZeroEventGuards=new Set(['INPUT_TARGET_OCCLUDED','POINTER_UNAVAILABLE','INPUT_GEOMETRY_CHANGED','WINDOW_UNAVAILABLE','WINDOW_CLOAKED']);
// In-process provenance: generated only by this adapter before invoking native
// input. It is separate from a native receipt and cannot be supplied by a runner.
const adapterRejections=new WeakSet();
export function validWindowsAdapterNoInputProof(p,{actionId,command,bridgeHash,error}={}){
  return !!p&&adapterRejections.has(p)&&p.schema===1&&p.phase==='before_native_dispatch'&&p.actionId===actionId&&
    same(p.command,command)&&p.bridgeHash===bridgeHash&&p.error===error;
}
export function validWindowsNoInputProof(p,{actionId,command,bridgeHash,error,inputReservedAt,lifecycle=false}){
  const r=p?.receipt;
  const t=p?.terminal;
  const closedProof=closedZeroEventGuards.has(error)&&['tap','swipe'].includes(command?.type)&&lifecycle!==true&&p?.lifecycle===false&&p.dispatchTempAbsent===true&&
    t?.op==='input'&&t.closed===true&&t.code===1&&t.signal===null&&t.actionId===actionId&&t.stateHash===p.stateHash&&
    t.commandHash===digest(Buffer.from(JSON.stringify(command)))&&
    Number.isFinite(Date.parse(p.inputReservedAt))&&(inputReservedAt===undefined||p.inputReservedAt===inputReservedAt)&&
    Date.parse(p.inputReservedAt)<=Date.parse(t.startedAt)&&Date.parse(t.startedAt)<=Date.parse(r?.startedAt)&&
    Date.parse(r?.completedAt)<=Date.parse(t.closedAt);
  return p?.schema===1&&p.provider===WINDOWS_PROVIDER&&p.bridgeHash===bridgeHash&&p.dispatchMarkerAbsent===true&&(preDispatchGuards.has(error)||closedProof)&&/^[a-f0-9]{64}$/.test(p.stateHash??'')&&same(p.command,command)&&
    r?.actionId===actionId&&r.status==='not_issued'&&r.attempted===0&&r.inserted===0&&r.releaseInserted===0&&r.error===error&&typeof error==='string'&&error.length>0&&r.gameResultVerified===false&&
    Number.isFinite(Date.parse(r.startedAt))&&Number.isFinite(Date.parse(r.completedAt))&&Date.parse(r.startedAt)<=Date.parse(r.completedAt);
}
export function validateWindowsSession(s){
  const t=s.windowsTarget;
  if(s.provider!==WINDOWS_PROVIDER||!positive(t?.hwnd)||!positive(t?.pid)||!/^\d{15,20}$/.test(t?.processStartedTicks??'')||
      typeof t?.processPath!=='string'||!/[\\/]crosvm\.exe$/i.test(t.processPath)||typeof t?.title!=='string'||!t.title.includes('Township')||
      typeof s.windowsBridge!=='string'||!s.windowsBridge||!/^[a-f0-9]{64}$/.test(s.windowsBridgeHash??'')||
      !positive(s.windowsCaptureSize?.width)||!positive(s.windowsCaptureSize?.height))fail('WINDOWS_CONFIG_INVALID');
  if(s.windowsViewport)validateBox(s.windowsViewport,s.windowsCaptureSize.width,s.windowsCaptureSize.height);
  if(s.serial!==windowsSerial(t)||s.packageName!=='com.playrix.township')fail('WINDOWS_TARGET_MISMATCH');
  return s;
}
export function validateWindowsPacket(s,p){
  validateWindowsSession(s);
  if(p.provider!==WINDOWS_PROVIDER||!same(targetIdentity(p.captureTarget),targetIdentity(s.windowsTarget)))fail('CAPTURE_TARGET_MISMATCH');
  const {bounds,client,dpi,virtualDesktop}=p.captureTarget??{};
  for(const box of [bounds,client,virtualDesktop])if(!box||!['x','y','width','height'].every(k=>Number.isSafeInteger(box[k]))||box.width<1||box.height<1)fail('CAPTURE_GEOMETRY_INVALID');
  if(!positive(dpi)||bounds.width!==s.windowsCaptureSize.width||bounds.height!==s.windowsCaptureSize.height)fail('CAPTURE_GEOMETRY_CHANGED');
  if(!/^\d+$/.test(p.sourceQpcTicks??''))fail('CAPTURE_SOURCE_TIME_REQUIRED');
}
export function compareWindowsGeometry(oldPacket,newPacket){
  for(const k of ['bounds','client','dpi','virtualDesktop'])if(!same(oldPacket.captureTarget?.[k],newPacket.captureTarget?.[k]))fail('WINDOW_GEOMETRY_CHANGED');
  if(!same(targetIdentity(oldPacket.captureTarget),targetIdentity(newPacket.captureTarget)))fail('WINDOW_IDENTITY_CHANGED');
}
export function runWindowsBridge(executable,request,{signal=null,timeoutMs=15000,spawnImpl=spawn}={}){
  return new Promise((resolvePromise,reject)=>{
    if(signal?.aborted){reject(Error('CAPTURE_CANCELLED'));return;}
    const child=spawnImpl(executable,[],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out=[],size=0,failure=null;
    const capture=request.op==='capture',startedAt=Date.now(),started=performance.now(),call=new WindowsBridgeCall(request,startedAt);
    const inputTerminal=call.inputTerminal,stderr=new BoundedBridgeStderr();
    const diagnostic=capture?{schema:1,provider:WINDOWS_PROVIDER,op:'capture',startedAt:new Date(startedAt).toISOString(),
      pid:child.pid??null,timeoutMs,target:targetIdentity(request.target),killRequested:false,killResult:null,exit:null,close:null}:null;
    const finish=(error,result)=>{if(!call.settle())return;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error&&inputTerminal){
        const bytes=Buffer.concat(out);
        error.nativeInputFailure={schema:1,receipt:error.nativeInputReceipt??null,terminal:structuredClone(inputTerminal),
          response:{text:bytes.subarray(0,65536).toString('utf8'),sha256:digest(bytes),byteLength:bytes.length,truncated:bytes.length>65536}};
      }
      if(error&&diagnostic)try{error.bridgeDiagnostic={...diagnostic,error:error.message,completedAt:new Date().toISOString(),elapsedMs:performance.now()-started,
        ...stderr.snapshot()};}catch{}
      error?reject(error):resolvePromise(result);};
    const cancel=error=>{
      if(failure||call.settled)return;failure=error;
      // Terminating an input process can strand its owned button-down. The caller
      // records unknown; the live helper keeps its mutex, sees the changed permit
      // at its next guard and completes finally cleanup. Never replay that action.
      if(request.op==='input')finish(error);
      else{if(diagnostic){diagnostic.killRequested=true;diagnostic.killRequestedAt=new Date().toISOString();}
        const killed=child.kill();if(diagnostic)diagnostic.killResult=killed;} // Ownership still waits for close.
    };
    const abort=()=>cancel(Error('CAPTURE_CANCELLED'));
    const timer=setTimeout(()=>{if(diagnostic)diagnostic.timeoutAt=new Date().toISOString();cancel(Error('WINDOWS_BRIDGE_TIMEOUT'));},timeoutMs);
    child.on('error',e=>{if(diagnostic)diagnostic.childError=String(e.message).slice(0,4096);finish(e);});child.stdin.on('error',e=>{if(diagnostic)diagnostic.stdinError=String(e.message).slice(0,4096);finish(e);});
    child.stdout.on('data',b=>{if(call.settled||failure)return;size+=b.length;if(size>40*1024*1024)cancel(Error('WINDOWS_BRIDGE_OUTPUT_LIMIT'));else out.push(b);});
    if(diagnostic)child.stderr.on('data',chunk=>{try{stderr.append(chunk);}catch{diagnostic.stderrReadFailed=true;}});
    else child.stderr.resume();
    child.on('exit',(code,signal)=>{call.exited();if(diagnostic)diagnostic.exit={code,signal,at:new Date().toISOString()};});
    child.on('close',(code,signal)=>{call.closed(code,signal);if(call.settled)return;if(diagnostic)diagnostic.close={code,signal,at:new Date().toISOString()};
      if(failure){finish(failure);return;}try{const response=JSON.parse(Buffer.concat(out).toString('utf8'));if(response.ok!==true){const error=Error(response.error??'WINDOWS_BRIDGE_FAILED');
        if(request.op==='input'){if(inputTerminal)error.nativeInputTerminal=structuredClone(inputTerminal);if(Object.hasOwn(response,'inputReceipt'))error.nativeInputReceipt=response.inputReceipt;}
        throw error;}finish(null,response.result);}catch(e){finish(e);}});
    signal?.addEventListener('abort',abort,{once:true});child.stdin.end(JSON.stringify(request));
  });
}
export class WindowsDevice{
  constructor(session,{runner=runWindowsBridge}={}){this.session=structuredClone(validateWindowsSession(session));this.runner=runner;this.inputBusy=false;}
  async command(op,args={},options={}){
    const s=this.session;
    if(this.runner===runWindowsBridge&&digest(readFileSync(join(dirname(s.windowsBridge),'TownshipDesktopBridge.dll')))!==s.windowsBridgeHash)fail('WINDOWS_BRIDGE_CHANGED');
    return this.runner(s.windowsBridge,{op,target:s.windowsTarget,...args},options);
  }
  async assertTarget(options={}){const actual=await this.command('describe',{},options);if(!same(targetIdentity(actual),targetIdentity(this.session.windowsTarget)))fail('WINDOW_IDENTITY_CHANGED');return actual;}
  async capture(options={}){
    const result=await this.command('capture',{},options),bytes=Buffer.from(result.bytes??'','base64'),image=decodePng(bytes);
    if(digest(bytes)!==result.sha256||image.width!==result.width||image.height!==result.height)fail('WINDOWS_CAPTURE_INTEGRITY_ERROR');
    const p={...result,bytes,image,provider:WINDOWS_PROVIDER,serial:this.session.serial,packageName:this.session.packageName};
    validateWindowsPacket(this.session,p);
    if(image.width!==p.captureTarget.bounds.width||image.height!==p.captureTarget.bounds.height)fail('CAPTURE_GEOMETRY_CHANGED');
    const start=Date.parse(p.startedAt),end=Date.parse(p.observedAt);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)fail('CAPTURE_TIME_INVALID');
    return p;
  }
  async navigate(action,{width,height,beforeInput,expected,permit,coordinates}={}){
    if(this.inputBusy)fail('WINDOWS_INPUT_BUSY');
    if(!beforeInput||!permit||!expected||!this.session.windowsViewport)fail('WINDOWS_INPUT_PREFLIGHT_REQUIRED');
    if(width!==this.session.windowsCaptureSize.width||height!==this.session.windowsCaptureSize.height)fail('CAPTURE_GEOMETRY_CHANGED');
    action=resolveWindowsInputCommand(this.session,action,coordinates,{width,height});
    this.inputBusy=true;let nativeDispatchStarted=false;
    try{
      const actual=await this.assertTarget();compareWindowsGeometry(expected,{captureTarget:actual});const guard=beforeInput();if(guard?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');
      const stateBytes=readFileSync(permit.statePath),envelope=JSON.parse(stateBytes),s=envelope.state,a=s?.actions?.[permit.actionId];
      if(digest(Buffer.from(JSON.stringify(s)))!==envelope.checksum)fail('MUMU_STATE_INTEGRITY_ERROR');
      if(s?.input!==permit.actionId||a?.status!=='pending'||s.stopCapture||s.stopReader||!same(a.command,action)||!same(windowsInputEvidence(s,a)?.captureTarget,expected.captureTarget))fail('WINDOWS_INPUT_PERMIT_CHANGED');
      if(!same(a.percentageCommand,coordinates))fail('INPUT_PERCENTAGE_COMMAND_CHANGED');
      const inputSequence=validateWindowsInputSequence(a.inputSequence,a);
      let receipt;
      try{nativeDispatchStarted=true;receipt=await this.command('input',windowsInputArguments({action,coordinates,expected:expected.captureTarget,viewport:this.session.windowsViewport,permit,stateHash:digest(stateBytes),inputSequence}));}
      catch(error){
        const r=error.nativeInputReceipt,terminal=error.nativeInputFailure?.terminal??error.nativeInputTerminal??null;
        if(error.nativeInputFailure||r!==undefined||terminal)error.windowsInputFailure={schema:1,provider:WINDOWS_PROVIDER,bridgeHash:this.session.windowsBridgeHash,
          stateHash:digest(stateBytes),command:structuredClone(action),error:error.message,receipt:r===undefined?null:structuredClone(r),terminal:structuredClone(terminal),
          response:error.nativeInputFailure?.response?structuredClone(error.nativeInputFailure.response):null};
        const marker=join(dirname(permit.statePath),'desktop-input',digest(Buffer.from(permit.actionId))+'.json');
        if(action.type==='swipe'||inputSequence){
          let savedMarker=null;try{savedMarker=JSON.parse(readFileSync(marker,'utf8'));}catch{}
          const context={actionId:permit.actionId,command:action,stateHash:digest(stateBytes),bridgeHash:this.session.windowsBridgeHash,inputReservedAt:a.inputReservedAt,marker:savedMarker};
          const completed=inputSequence?completedWindowsSendReceipt(error.windowsInputFailure,context,inputSequence):completedWindowsDragReceipt(error.windowsInputFailure,context);
          if(completed){validateIssuedWindowsReceipt(completed,permit.actionId,inputSequence);return {...completed,commandIssued:true};}
        }
        const proof={schema:1,provider:WINDOWS_PROVIDER,bridgeHash:this.session.windowsBridgeHash,stateHash:digest(stateBytes),dispatchMarkerAbsent:!existsSync(marker),command:structuredClone(action),receipt:r===undefined?null:structuredClone(r)};
        if(closedZeroEventGuards.has(error.message))Object.assign(proof,{terminal:structuredClone(terminal),dispatchTempAbsent:!existsSync(marker+'.tmp'),inputReservedAt:a.inputReservedAt,lifecycle:!!a.lifecycle});
        if((!terminal||(terminal.closed===true&&terminal.code===1&&terminal.signal===null))&&
          validWindowsNoInputProof(proof,{actionId:permit.actionId,command:action,bridgeHash:this.session.windowsBridgeHash,error:error.message,inputReservedAt:a.inputReservedAt,lifecycle:!!a.lifecycle}))error.windowsNoInputProof=proof;
        throw error;
      }
      validateIssuedWindowsReceipt(receipt,permit.actionId,inputSequence);
      return {...receipt,commandIssued:true};
    }catch(error){
      if(!nativeDispatchStarted){
        const p={schema:1,phase:'before_native_dispatch',actionId:permit.actionId,command:structuredClone(action),bridgeHash:this.session.windowsBridgeHash,error:error.message};
        adapterRejections.add(p);error.windowsAdapterNoInputProof=p;
      }
      throw error;
    }finally{this.inputBusy=false;}
  }
}
