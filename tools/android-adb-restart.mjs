import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest} from './adb.mjs';
import {androidConfig} from './android-adb-device.mjs';
import {ownerExited,processIdentity} from './mumu-process-owner.mjs';
import {recoverExitedLock,recoveryFencePresent} from './mumu-persistence.mjs';
import {isUnresolvedAction} from './mumu-input-state.mjs';

export function adbInputClientForSession(client,session){
  if(typeof client?.CommandLine!=='string'||!client.CommandLine.trim())throw Error('STARTUP_ADB_PROCESS_STATE_REQUIRED');
  const text=client.CommandLine,tokens=(text.match(/"[^"]*"|[^\s]+/g)??[]).map(t=>t.replace(/^"|"$/g,''));
  const shell=tokens.findIndex(t=>['shell','exec-in','exec-out'].includes(t));
  if(shell<0||!/(?:^|[\s;/&|()])input(?:\s|$)|com\.android\.commands\.input\./.test(tokens.slice(shell+1).join(' ')))return false;
  const selector=tokens.slice(0,shell).indexOf('-s');
  // An unqualified input client may target this device. Explicit other-device
  // commands and read-only queries do not own Township input.
  return selector<0||tokens[selector+1]===session.serial||tokens[selector+1]===session.adbTarget.deviceSerial;
}

export function assertAndroidInputIdle(session,{exec=execFileSync}={}){
  androidConfig(session);
  if(digest(readFileSync(session.executable))!==session.adbExecutableHash)throw Error('ADB_EXECUTABLE_CHANGED');
  const options={windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024};
  // A detached local client could dispatch after a remote process snapshot.
  const local=JSON.parse(exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "$ErrorActionPreference='Stop'; $p=@(Get-CimInstance Win32_Process -Filter \"Name = 'adb.exe' AND ThreadCount > 0\" | Select-Object CommandLine); ConvertTo-Json -InputObject $p -Compress"],options));
  if(!Array.isArray(local))throw Error('STARTUP_ADB_PROCESS_STATE_REQUIRED');
  if(local.some(client=>adbInputClientForSession(client,session)))throw Error('STARTUP_ADB_CLIENT_ACTIVE');
  const command=args=>exec(session.executable,['-s',session.serial,...args],options).trim();
  if(command(['get-state'])!=='device'||command(['shell','getprop','ro.serialno'])!==session.adbTarget.deviceSerial)
    throw Error('ADB_TARGET_CHANGED');
  const processes=command(['shell','ps','-A','-ww','-o','PID,ARGS']);
  if(!/^\s*PID\s+ARGS\b/.test(processes))throw Error('STARTUP_ADB_PROCESS_STATE_REQUIRED');
  if(/com\.android\.commands\.input\.|(?:^|[\s/;&|()])input(?:\s|$)/m.test(processes))throw Error('STARTUP_ADB_INPUT_ACTIVE');
}

// Retire only this session's abandoned device fence. The caller commits
// unconfirmed supersession before retiring its outstanding dispatch marker.
export function recoverAndroidRestart(state,{lockRoot=join(tmpdir(),'township-adb-input'),
  inputIdle=assertAndroidInputIdle,inspect=processIdentity}={}){
  const session=state.session;
  const file=join(lockRoot,digest(Buffer.from(session.adbTarget.deviceSerial))+'.lock');
  if(!existsSync(file)&&!recoveryFencePresent(file)&&!state.input&&!Object.values(state.actions??{}).some(isUnresolvedAction))return;
  const exited=owner=>{
    // Modern recovery fences have no actionId; their process identity is enough.
    if(owner?.schema===1){
      if(owner.actionId&&(owner.serial!==session.serial||!state.actions?.[owner.actionId]))return false;
      return ownerExited(owner,{inspect});
    }
    // One-time migration of the original Android fence format. A live/reused
    // PID is deliberately not accepted without the creation identity.
    return owner?.serial===session.serial&&typeof owner.actionId==='string'&&!!state.actions?.[owner.actionId]&&
      Number.isSafeInteger(owner.pid)&&owner.pid>0&&Number.isFinite(Date.parse(owner.at))&&inspect(owner.pid)?.alive===false;
  };
  inputIdle(session);
  recoverExitedLock(file,{exited,beforeRecover:owner=>{
    // Recovery protectors have no action binding. An original device fence
    // must still belong to this session, including the modern owner format.
    if(owner&&(owner.serial!==session.serial||typeof owner.actionId!=='string'||!state.actions?.[owner.actionId]))
      throw Error('STARTUP_ADB_OWNER_NOT_SETTLED');
    inputIdle(session);
  }});
  if(existsSync(file)||recoveryFencePresent(file))throw Error('STARTUP_ADB_OWNER_NOT_SETTLED');
}
