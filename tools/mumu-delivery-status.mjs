import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {atomic} from './mumu-persistence.mjs';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));
const presentationIoCodes=new Set(['EACCES','EPERM','EBUSY','ENOSPC','EROFS','ENOENT','EMFILE','ENFILE','EIO','EEXIST','ENOTDIR','EISDIR']);
export const isPresentationIoError=error=>presentationIoCodes.has(error?.code);
// Retain the public JSON shape and property order; internal state stays owned by MonitorDelivery.
export const deliveryStatus=(state,running)=>({...state,running,executionAllowed:false});
export function saveDeliveryStatus(store,owner,status){
      const cache=join(store.root,'.monitor');
      try{owner??=JSON.parse(readFileSync(join(store.root,'capture.lock'),'utf8'));}catch{}
      const sourceState=store.load();
      const record={sessionId:sourceState.session.id,startupIncarnation:sourceState.orderDemandStartup?.currentIncarnation??null,ownerPid:process.pid,
        ownerToken:owner?.pid===process.pid?owner.token??null:null,status};
      try{mkdirSync(cache,{recursive:true});atomic(join(cache,'delivery.json'),{schema:1,checksum:sha(record),record});return {saved:true};}
      catch(error){if(!isPresentationIoError(error))throw error;return {saved:false,error:error.code};}
}
