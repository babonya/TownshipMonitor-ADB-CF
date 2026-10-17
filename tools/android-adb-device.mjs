import {AdbDevice,runProcess,decodePng,digest} from './adb.mjs';
import {inputGeometry,resolvePercentageCommand} from './percentage-coordinates.mjs';
import {readFileSync,existsSync,openSync,writeFileSync,closeSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {isUnresolvedAction} from './mumu-input-state.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {processOwner} from './mumu-process-owner.mjs';
import {recoveryFencePresent} from './mumu-persistence.mjs';
import {fileIdentity,readStableFile} from './mumu-file-identity.mjs';
import {marketDragScript,MARKET_ENDPOINT,MARKET_RELEASED,MARKET_CAPTURE_PREFIX,matchesEndpointCapture} from './android-market-drag.mjs';
import {rawScreencapToPng} from './android-raw-capture.mjs';

export const ANDROID_ADB_PROVIDER='android_adb';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Error(code);};
const rejected=new WeakSet();
export const validAdbNoInputProof=(error,actionId)=>!!error&&rejected.has(error)&&error.adbNoInputProof?.actionId===actionId;
export function androidConfig(s){
  new AdbDevice(s);
  const t=s.adbTarget;
  if(s.provider!==ANDROID_ADB_PROVIDER||!isAbsolute(s.executable)||!/^[a-f0-9]{64}$/.test(s.adbExecutableHash??'')||s.packageName!=='com.playrix.township'||
    !t||!/^[-a-zA-Z0-9_.:]+$/.test(t.deviceSerial??'')||!/^[a-f0-9-]{36}$/.test(t.bootId??'')||t.displayId!==0||!/^\d{1,20}$/.test(t.physicalDisplayId??'')||BigInt(t.physicalDisplayId)>18446744073709551615n||
    ![0,90,180,270].includes(t.rotation)||![t.width,t.height].every(n=>Number.isSafeInteger(n)&&n>0))fail('ANDROID_ADB_CONFIG_INVALID');
  return {provider:ANDROID_ADB_PROVIDER,executable:s.executable,adbExecutableHash:s.adbExecutableHash,serial:s.serial,packageName:s.packageName,adbTarget:structuredClone(t)};
}
export function parseAndroidDisplay(text,packageName){
  const displays=[...text.matchAll(/^\s*Display: mDisplayId=(\d+)/gm)];
  const primary=displays.filter(d=>d[1]==='0');if(primary.length!==1)fail('ADB_DISPLAY_UNSUPPORTED');
  const start=primary[0].index,end=displays.find(d=>d.index>start)?.index??text.length;
  text=text.slice(start,end);
  const size=text.match(/\bcur=(\d+)x(\d+)\s+app=/),rotation=text.match(/mDisplayRotation=ROTATION_(0|90|180|270)\b/);
  const focus=text.split(/\r?\n/).filter(l=>/mCurrentFocus=/.test(l));
  if(focus.length!==1||!focus[0].includes(' '+packageName+'/'))fail('ADB_TARGET_NOT_FOREGROUND');
  if(!size||!rotation)fail('ADB_DISPLAY_GEOMETRY_REQUIRED');
  return {displayId:0,width:Number(size[1]),height:Number(size[2]),rotation:Number(rotation[1])};
}
// One read-only shell session, with explicit section boundaries. A successful
// shell connection already establishes get-state=device; no extra round trip.
export const ANDROID_INSPECTION_SCRIPT="printf '__TOWNSHIP_SERIAL__\\n' && getprop ro.serialno && printf '__TOWNSHIP_BOOT__\\n' && cat /proc/sys/kernel/random/boot_id && printf '__TOWNSHIP_WINDOW__\\n' && dumpsys window displays && printf '__TOWNSHIP_DISPLAY__\\n' && dumpsys SurfaceFlinger --display-id && printf '__TOWNSHIP_END__\\n'";
export function parseAndroidInspection(output,packageName='com.playrix.township'){
  const text=output.toString().replaceAll('\r','');
  const sections=text.match(/^__TOWNSHIP_SERIAL__\n([^\n]+)\n__TOWNSHIP_BOOT__\n([^\n]+)\n__TOWNSHIP_WINDOW__\n([\s\S]*?)__TOWNSHIP_DISPLAY__\n([\s\S]*?)__TOWNSHIP_END__\n?$/);
  if(!sections||!/^[-a-zA-Z0-9_.:]+$/.test(sections[1])||!/^[a-f0-9-]{36}$/.test(sections[2]))fail('ADB_INSPECTION_INVALID');
  const [,deviceSerial,bootId,window,physical]=sections;
  const display=parseAndroidDisplay(window,packageName);
  const ids=[...physical.matchAll(/^Display (\d+) \(HWC display 0\):/gm)];
  if(ids.length!==1)fail('ADB_PHYSICAL_DISPLAY_REQUIRED');
  return {deviceSerial,bootId,...display,physicalDisplayId:ids[0][1]};
}
export async function inspectAndroid({executable,serial,packageName='com.playrix.township',runner=runProcess,signal}){
  const d=new AdbDevice({executable,serial,packageName,runner});
  return parseAndroidInspection((await d.command(['shell',ANDROID_INSPECTION_SCRIPT],{signal})).stdout,packageName);
}
export function validateAndroidPacket(s,p){
  androidConfig(s);
  const width=p.image?.width??p.width??p.dimensions?.width,height=p.image?.height??p.height??p.dimensions?.height;
  if(p.provider!==ANDROID_ADB_PROVIDER||p.serial!==s.serial||p.packageName!==s.packageName||!same(p.adbTarget,s.adbTarget))fail('CAPTURE_TARGET_MISMATCH');
  if(width!==s.adbTarget.width||height!==s.adbTarget.height)fail('ADB_GEOMETRY_CHANGED');
}
function permitState(session,permit,expected,coordinates,command){
  if(!permit?.statePath||!permit.actionId)fail('ADB_CANONICAL_PERMIT_REQUIRED');
  const e=JSON.parse(readFileSync(permit.statePath,'utf8')),s=e.state,a=s?.actions?.[permit.actionId];
  if(e.version!=='mumu-pipeline-1'||!s||digest(Buffer.from(JSON.stringify(s)))!==e.checksum)fail('MUMU_STATE_INTEGRITY_ERROR');
  if(!same(androidConfig(s.session),session))fail('ADB_SESSION_CHANGED');
  if(s.stopCapture||s.stopReader)fail('SESSION_STOPPED');
  if(s.input!==permit.actionId||a?.status!=='pending'||Object.values(s.actions).some(x=>x.id!==a.id&&isUnresolvedAction(x)))fail('INPUT_UNRESOLVED');
  if(!same(a.percentageCommand,coordinates)||!same(a.command,command)||a.epoch!==s.scene.epoch)fail('ADB_PERMIT_CHANGED');
  const f=s.frames[a.frameId];
  if(!f||f.evidenceHash!==a.coordinateSource?.evidenceHash||a.coordinateSource?.frameId!==f.id||f.epoch+1!==a.epoch||s.observationInvalidation?.sequence>=f.sequence)fail('ADB_SOURCE_CHANGED');
  validateAndroidPacket(session,f);validateAndroidPacket(session,expected);
  if(a.somProof&&(s.latestFrameId!==f.id||expected.id!==f.id||expected.evidenceHash!==f.evidenceHash))fail('ADB_SOURCE_CHANGED');
  const now=Date.now(),observed=Date.parse(f.observedAt),decided=Date.parse(a.at),reserved=Date.parse(a.inputReservedAt);
  if(a.somProof){
    if(![observed,decided,reserved].every(Number.isFinite)||observed>decided||decided>reserved||reserved>now||now-reserved>=5000)fail('INPUT_OBSERVATION_EXPIRED');
  }else{
    const p=a.preflightEvidence,t=Date.parse(p?.observedAt);
    if(!p||p.actionId!==a.id||p.sourceFrameId!==f.id||p.epoch!==a.epoch||!Buffer.isBuffer(expected.bytes)||
      p.evidenceHash!==digest(expected.bytes)||p.observedAt!==expected.observedAt||p.captureStartedAt!==expected.startedAt)fail('ADB_PREFLIGHT_CHANGED');
    validateAndroidPacket(session,p);
    if(!Number.isFinite(t)||t>now||now-t>=5000)fail('INPUT_PREFLIGHT_EXPIRED');
  }
  const root=dirname(permit.statePath);
  for(const name of ['.management/runner.lock','helicopter-runner.lock'])if(existsSync(join(root,name)))fail('FOREIGN_INPUT_OWNER');
  if(existsSync(join(root,'capture.lock'))){const o=JSON.parse(readFileSync(join(root,'capture.lock'),'utf8'));if(o.pid!==process.pid||!o.token||a.somProof&&o.token!==a.somProof.ownerToken)fail('CAPTURE_PRODUCER_NOT_OWNED');}
  else if(a.somProof)fail('CAPTURE_PRODUCER_NOT_OWNED');
  const q=a.inputSequence;
  if(q&&(q.kind!=='som_helicopter_send_skip'||q.delayMs!==100||q.clickCount!==2||q.ownerPid!==process.pid||
    Object.keys(q).length!==4||a.target?.kind!=='som_send'||a.target.som?.kind!=='som_send'||
    a.target.som.next!=='helicopter'||typeof a.target.som.orderHash!=='string'||!a.target.som.orderHash||
    a.command.type!=='tap'||!a.somProof?.ownerToken))fail('INPUT_SEQUENCE_INVALID');
  return a;
}
export class AndroidAdbDevice extends AdbDevice{
  constructor(session,{runner=runProcess,lockRoot=join(tmpdir(),'township-adb-input')}={}){
    super({...session,runner});this.session=androidConfig(session);this.lockRoot=lockRoot;this.lastGameLaunch=0;
  }
  // [사용자 변경 2026-10-16] 시작을 눌렀는데 게임이 꺼져 있으면(ADB_TARGET_NOT_FOREGROUND) 게임을 띄운다.
  // 화면이 켜져 있고 전면이 홈 화면(런처)일 때만 — 사람이 다른 앱을 쓰는 중이면 건드리지 않는다. 60초에 한 번까지.
  async launchGameIfHome({signal}={}){
    const now=Date.now();if(now-this.lastGameLaunch<60000)return false;
    const out=(await this.command(['shell','dumpsys window | grep -m1 mCurrentFocus; dumpsys power | grep -m1 -o "mWakefulness=[A-Za-z]*"'],{signal})).stdout.toString();
    if(!/mWakefulness=Awake/.test(out)||!/[Ll]auncher/.test(out))return false;
    this.lastGameLaunch=now;
    await this.command(['shell',`monkey -p ${this.packageName} -c android.intent.category.LAUNCHER 1`],{signal});
    console.error(`[android] ${this.packageName} launched from home screen`);
    return true;
  }
  async assertTarget({signal}={}){
    const identity=fileIdentity(this.executable);
    if(this.executableIdentity!==identity){
      const checked=readStableFile(this.executable);
      if(digest(checked.bytes)!==this.session.adbExecutableHash)fail('ADB_EXECUTABLE_CHANGED');
      this.executableIdentity=checked.identity;
    }
    const t=await inspectAndroid({...this.session,runner:this.runner,signal});
    if(!same(t,this.session.adbTarget))fail('ADB_TARGET_OR_GEOMETRY_CHANGED');return t;
  }
  async capture({signal,resultAction}={}){
    const queued=this.endpointResult;this.endpointResult=null;
    if(queued&&resultAction?.id===queued.actionId){
      const e=JSON.parse(readFileSync(queued.statePath,'utf8')),s=e.state,a=s?.actions?.[queued.actionId];
      if(e.version!=='mumu-pipeline-1'||digest(Buffer.from(JSON.stringify(s)))!==e.checksum)fail('MUMU_STATE_INTEGRITY_ERROR');
      if(signal?.aborted||s.stopCapture||s.stopReader)fail('SESSION_STOPPED');
      if(s.input===a?.id&&['issued','captured'].includes(a.status)&&s.scene.epoch===a.epoch&&
        same(androidConfig(s.session),this.session)&&matchesEndpointCapture(a,queued.packet)&&
        same(a.deviceReceipt,resultAction.deviceReceipt))return queued.packet;
    }
    const startedAt=new Date().toISOString();await this.assertTarget({signal});
    const raw=(await this.command(['exec-out','screencap','-d',this.session.adbTarget.physicalDisplayId],{signal})).stdout;
    // Raw screencap skips PNG encoding on the phone; PNG is built here so later stages are unchanged.
    const stdout=rawScreencapToPng(raw),image=decodePng(stdout);
    const adbTarget=await this.assertTarget({signal});
    const packet={provider:ANDROID_ADB_PROVIDER,serial:this.serial,packageName:this.packageName,adbTarget,bytes:stdout,image,startedAt,observedAt:new Date().toISOString()};
    validateAndroidPacket(this.session,packet);return packet;
  }
  async navigate(command,{width,height,beforeInput,coordinates,expected,permit,signal}={}){
    let dispatched=false,fd,lock,owned=false,completedClicks=0,plannedClicks=0;
    let endpointPacket=null;
    try{
      if(this.inputBusy)fail('ADB_INPUT_BUSY');
      command=resolvePercentageCommand(coordinates,inputGeometry(this.session,{width,height}),command);
      if(typeof beforeInput!=='function')fail('ADB_INPUT_GUARD_REQUIRED');
      this.inputBusy=true;owned=true;
      mkdirSync(this.lockRoot,{recursive:true});lock=join(this.lockRoot,digest(Buffer.from(this.session.adbTarget.deviceSerial))+'.lock');
      if(recoveryFencePresent(lock))fail('ADB_INPUT_OWNER_UNSETTLED');
      try{fd=openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')fail('ADB_INPUT_OWNER_UNSETTLED');throw e;}
      writeFileSync(fd,JSON.stringify({...processOwner(),actionId:permit?.actionId,serial:this.serial,at:new Date().toISOString()}));
      if(recoveryFencePresent(lock))fail('ADB_INPUT_OWNER_UNSETTLED');
      await this.assertTarget({signal});
      if(signal?.aborted)fail('PROCESS_ABORTED');
      const guard=beforeInput();if(guard?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');
      const action=permitState(this.session,permit,expected,coordinates,command);
      const sequence=action.inputSequence??null;
      this.endpointResult=null;
      plannedClicks=command.type==='tap'?(sequence?.clickCount??1):0;
      const args=command.type==='tap'?['tap',command.x,command.y]:['swipe',command.x1,command.y1,command.x2,command.y2,command.durationMs];
      const markerRoot=join(dirname(permit.statePath),'adb-dispatch');mkdirSync(markerRoot,{recursive:true});
      const marker=join(markerRoot,digest(Buffer.from(permit.actionId))+'.json');
      // An earlier attempt may have reached Android even if its client disappeared.
      if(existsSync(marker)){dispatched=true;fail('ADB_ACTION_ALREADY_DISPATCHED');}
      const markerFd=openSync(marker,'wx');
      dispatched=true;const startedAt=new Date().toISOString();
      try{writeFileSync(markerFd,JSON.stringify({actionId:permit.actionId,command,coordinates,inputSequence:sequence,source:expected.evidenceHash??digest(expected.bytes),startedAt}));}finally{closeSync(markerFd);}
      // A timeout/disconnect may leave a remote command running. Keep the device fence
      // and canonical unknown action; never infer zero input from an ADB client exit.
      if(command.type==='swipe'&&action.target?.kind==='som_scroll'&&action.target?.som?.kind==='som_scroll'&&action.somProof){
        let events='',captureStartedAt=null,releasedAt=null;
        // exec-out merges stderr into stdout: the two marker lines come first, then the raw screencap.
        const onStdout=chunk=>{
          if(events.length<128)events+=chunk.subarray(0,128-events.length).toString('latin1');
          if(!captureStartedAt&&events.includes(MARKET_ENDPOINT+'\n'))captureStartedAt=new Date().toISOString();
          if(!releasedAt&&events.includes(MARKET_RELEASED+'\n'))releasedAt=new Date().toISOString();
        };
        const script=marketDragScript(command,this.session.adbTarget.physicalDisplayId);
        const result=await this.command(['exec-out',script],{signal,onStdout});
        if(!captureStartedAt||!releasedAt)fail('ANDROID_MARKET_RELEASE_UNCONFIRMED');
        const prefix=Buffer.from(MARKET_CAPTURE_PREFIX,'latin1');
        if(result.stdout.length<=prefix.length||!result.stdout.subarray(0,prefix.length).equals(prefix))fail('ANDROID_MARKET_CAPTURE_INVALID');
        // Raw capture (no PNG encoding on the phone); same PNG conversion as normal capture, hash is over the PNG bytes.
        const stdout=rawScreencapToPng(result.stdout.subarray(prefix.length));
        const image=decodePng(stdout),adbTarget=await this.assertTarget({signal}),observedAt=new Date().toISOString();
        const endpointCapture={schema:1,kind:'android_market_endpoint',actionId:action.id,sourceFrameId:action.frameId,
          epoch:action.epoch,holdMs:200,evidenceHash:digest(stdout),startedAt:captureStartedAt,releasedAt,observedAt};
        endpointPacket={provider:ANDROID_ADB_PROVIDER,serial:this.serial,packageName:this.packageName,adbTarget,
          bytes:stdout,image,startedAt:captureStartedAt,observedAt,evidenceHash:endpointCapture.evidenceHash,endpointCapture};
        validateAndroidPacket(this.session,endpointPacket);
      }else await this.command(['shell','input','touchscreen','-d','0',...args.map(String)],{signal});
      if(command.type==='tap')completedClicks++;
      if(sequence){
        // The pair remains one canonical action under one device fence. Recheck
        // stop/owner/source/target before the skip; never retry either dispatch.
        await delay(sequence.delayMs,undefined,{signal});
        await this.assertTarget({signal});
        if(signal?.aborted)fail('PROCESS_ABORTED');
        const nextGuard=beforeInput();if(nextGuard?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');
        const current=permitState(this.session,permit,expected,coordinates,command);
        if(!same(current.inputSequence,sequence))fail('ADB_PERMIT_CHANGED');
        await this.command(['shell','input','touchscreen','-d','0',...args.map(String)],{signal});
        completedClicks++;
      }
      closeSync(fd);fd=undefined;unlinkSync(lock);lock=null;
      const receipt={provider:ANDROID_ADB_PROVIDER,actionId:permit.actionId,status:'issued',commandIssued:true,command,plannedClicks,completedClicks,adbTarget:this.session.adbTarget,startedAt,completedAt:new Date().toISOString(),gameResultVerified:false,
        ...(endpointPacket?{endpointCapture:endpointPacket.endpointCapture}:{})};
      if(endpointPacket)this.endpointResult={actionId:action.id,statePath:permit.statePath,packet:endpointPacket};
      return receipt;
    }catch(error){
      if(!dispatched){error.adbNoInputProof={schema:1,actionId:permit?.actionId,phase:'before_adb_dispatch',error:error.message};rejected.add(error);}
      else error.adbInputFailure={schema:1,actionId:permit?.actionId,plannedClicks,completedClicks,error:error.message,gameResultVerified:false};
      throw error;
    }finally{
      if(fd!==undefined){closeSync(fd);if(lock&&!dispatched)unlinkSync(lock);}
      if(owned)this.inputBusy=false;
    }
  }
}
