// Shared atomic writes and process-owned locks. Recovery never repairs state.
import {openSync,writeFileSync,readFileSync,readdirSync,statSync,fstatSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {basename,dirname,join,resolve} from 'node:path';
import {processOwner,ownerExited,assertNativeInputIdle} from './mumu-process-owner.mjs';

function recoveryState(file){
  if(basename(file)!=='state.lock')return;
  const stateFile=join(dirname(file),'state.json');
  const e=JSON.parse(readFileSync(stateFile,'utf8'));
  if(e.version!=='mumu-pipeline-1'||!e.state||e.checksum!==createHash('sha256').update(JSON.stringify(e.state)).digest('hex'))throw Error('MUMU_STATE_INTEGRITY_ERROR');
  if(e.state.session?.provider==='google_play_windows')assertNativeInputIdle();
}

const sameIdentity=(a,b)=>['dev','ino','ctimeNs','mtimeNs','birthtimeNs','size'].every(k=>a[k]===b[k]);
function lockSnapshot(file){
  let fd;try{fd=openSync(file,'r');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  try{
    const identity=fstatSync(fd,{bigint:true}),bytes=readFileSync(fd),after=fstatSync(fd,{bigint:true});
    let pathIdentity;try{pathIdentity=statSync(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!sameIdentity(identity,after)||!sameIdentity(identity,pathIdentity))return null;
    let owner;try{owner=JSON.parse(bytes);}catch(error){if(!(error instanceof SyntaxError))throw error;owner=null;}
    return {identity,bytes,owner};
  }finally{closeSync(fd);}
}
const unchangedLock=(file,expected)=>{const current=lockSnapshot(file);return !!current&&sameIdentity(current.identity,expected.identity)&&current.bytes.equals(expected.bytes);};
function fenceFamily(file){
  file=resolve(file);
  const stem=basename(file)+'.recovery';let names;
  try{names=readdirSync(dirname(file));}catch(error){if(error.code==='ENOENT')return [];throw error;}
  return names.filter(n=>n===stem||n.startsWith(stem+'.')).sort().map(n=>({file:join(dirname(file),n),
    level:n===stem?0n:/^[1-9][0-9]{0,99}$/.test(n.slice(stem.length+1))?BigInt(n.slice(stem.length+1)):null}));
}
export const recoveryFencePresent=file=>fenceFamily(file).length>0;
function familyUnchanged(file,prior,own){
  const current=fenceFamily(file).filter(f=>f.file!==resolve(own));
  return current.length===prior.length&&current.every(f=>prior.some(p=>p.file===f.file&&unchangedLock(f.file,p.snapshot)));
}
function writeOwner(fd,owner){
  const bytes=Buffer.from(JSON.stringify(owner));writeFileSync(fd,bytes);fsyncSync(fd);
  return {identity:fstatSync(fd,{bigint:true}),bytes};
}
function releaseFence(fd,file,owned){
  closeSync(fd);
  // An externally replaced fence must survive even during our own cleanup.
  if(owned&&unchangedLock(file,owned))unlinkSync(file);
}

// Numeric siblings protect cleanup of interrupted fences. All cooperating
// acquisitions inspect the whole family, including a sibling left after the
// original .recovery was removed. Each takeover uses a new, exclusively-created
// level; no live/unknown owner or changed snapshot can be retired.
function recoverInterruptedFences(file,{exited=ownerExited,beforeRecover=()=>{},beforeFenceRemove=()=>{}}={}){
  const prior=fenceFamily(file);if(!prior.length)return true;
  for(const p of prior){
    p.snapshot=lockSnapshot(p.file);
    if(p.level===null||!p.snapshot||exited(p.snapshot.owner)!==true)return false;
  }
  const level=prior.reduce((m,p)=>p.level>m?p.level:m,0n)+1n,fence=file+'.recovery.'+level;let fd,owned;
  try{fd=openSync(fence,'wx');}catch(error){if(error.code==='EEXIST')return false;throw error;}
  try{
    owned=writeOwner(fd,processOwner());
    if(!unchangedLock(fence,owned)||!familyUnchanged(file,prior,fence)||prior.some(p=>exited(p.snapshot.owner)!==true))return false;
    recoveryState(file);beforeRecover(lockSnapshot(file)?.owner??null);
    beforeFenceRemove(prior.map(p=>p.file));
    if(!unchangedLock(fence,owned)||!familyUnchanged(file,prior,fence)||prior.some(p=>exited(p.snapshot.owner)!==true))return false;
    for(const p of prior.sort((a,b)=>a.level>b.level?-1:a.level<b.level?1:0)){
      if(!unchangedLock(p.file,p.snapshot))return false;
      unlinkSync(p.file);
    }
    return true;
  }finally{releaseFence(fd,fence,owned);}
}

export function recoverExitedLock(file,options={}){
  if(!recoverInterruptedFences(file,options))return false;
  const {exited=ownerExited,beforeRecover=()=>{},beforeRemove=()=>{}}=options;
  const original=lockSnapshot(file);if(!original||exited(original.owner)!==true)return false;
  const fence=file+'.recovery';let fd,owned;
  try{fd=openSync(fence,'wx');}catch(error){if(error.code==='EEXIST')return false;throw error;}
  try{
    owned=writeOwner(fd,processOwner());
    if(!unchangedLock(fence,owned)||!familyUnchanged(file,[],fence)||!unchangedLock(file,original)||exited(original.owner)!==true)return false;
    recoveryState(file);beforeRecover(original.owner);beforeRemove(original.owner);
    if(!unchangedLock(fence,owned)||!familyUnchanged(file,[],fence)||!unchangedLock(file,original)||exited(original.owner)!==true)return false;
    unlinkSync(file);return true;
  }finally{releaseFence(fd,fence,owned);}
}

export function acquireStateLock(file,{open=openSync,owner=null,...recovery}={}) {
  // Only exclusive-open failures occur before any transaction mutation.
  // Never classify errors from load, callback, save or cleanup as retryable.
  if(!recoverInterruptedFences(file,recovery))throw Error('MUMU_STORE_BUSY');
  recoverExitedLock(file,recovery);
  let fd;try{fd=open(file,'wx');}catch(error){
    if(['EEXIST','EPERM','EACCES','EBUSY'].includes(error.code))throw new Error('MUMU_STORE_BUSY',{cause:error});
    throw error;
  }
  let owned;try{
    owned=writeOwner(fd,owner??processOwner());
    if(recoveryFencePresent(file))throw Error('MUMU_STORE_BUSY');
    return fd;
  }catch(error){releaseFence(fd,file,owned);throw error;}
}

function atomicContent(file,contents,{rename=renameSync,pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),attempts=100}={}) {
  const temp=file+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx');
  try{writeFileSync(fd,contents());fsyncSync(fd);}finally{closeSync(fd);}
  try{
    for(let i=0;i<attempts;i++)try{rename(temp,file);return;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code) || i===attempts-1)throw error;pause(10);}
    throw Error('ATOMIC_RENAME_FAILED');
  }catch(error){unlinkSync(temp);throw error;}
}
export function atomic(file,value,{compact=false,...options}={}){
  return atomicContent(file,()=>compact?JSON.stringify(value):JSON.stringify(value,null,2)+'\n',options);
}
export function atomicBytes(file,bytes,options){
  if(!Buffer.isBuffer(bytes))throw Error('ATOMIC_BYTES_REQUIRED');
  return atomicContent(file,()=>bytes,options);
}
