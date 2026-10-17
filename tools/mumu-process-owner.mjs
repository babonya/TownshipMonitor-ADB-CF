import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const host=hostname();
export function processIdentity(pid){
  if(!Number.isSafeInteger(pid)||pid<1)return null;
  if(process.platform==='win32'){
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$p.StartTime.ToUniversalTime().Ticks.ToString()}else{'absent'}`],
      {windowsHide:true,encoding:'utf8',timeout:10000}).trim();
    return output==='absent'?{alive:false}:/^\d+$/.test(output)?{alive:true,start:output}:null;
  }
  if(process.platform==='linux'){
    try{const stat=readFileSync(`/proc/${pid}/stat`,'utf8');
      return {alive:true,start:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};
    }catch(error){if(error.code==='ENOENT')return {alive:false};throw error;}
  }
  return null;
}
let self;
export function processOwner(){
  self??=processIdentity(process.pid);
  if(!self?.alive||!self.start)throw Error('LOCK_PROCESS_IDENTITY_REQUIRED');
  return {schema:1,pid:process.pid,host,processStart:self.start,token:randomUUID(),startedAt:new Date().toISOString()};
}
// Unknown identity or another host is never proof of exit. A reused PID with a
// different creation identity proves that the original owner exited.
export function ownerExited(owner,{inspect=processIdentity}={}){
  if(owner?.schema!==1||owner.host!==host||!Number.isSafeInteger(owner.pid)||owner.pid<1||
    typeof owner.processStart!=='string'||!owner.processStart||typeof owner.token!=='string'||!owner.token)return false;
  const current=inspect===processIdentity&&owner.pid===process.pid?(self??=processIdentity(process.pid)):inspect(owner.pid);
  return current?.alive===false||current?.alive===true&&typeof current.start==='string'&&current.start!==owner.processStart;
}
export function assertNativeInputIdle(){
  const script=fileURLToPath(new URL('./windows-startup-idle.ps1',import.meta.url));
  const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',script],
    {windowsHide:true,encoding:'utf8',timeout:10000});
  if(JSON.parse(result).idle!==true)throw Error('STARTUP_NATIVE_INPUT_ACTIVE');
}
