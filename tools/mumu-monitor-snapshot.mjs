import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

// One persistent read-only worker. Query computation cannot occupy the input
// owner's event loop; identical concurrent queries share one outstanding job.
export class MonitorSnapshotReader {
  constructor({workerFactory=()=>new Worker(new URL(import.meta.url))}={}){
    this.worker=workerFactory();this.sequence=0;this.pending=new Map();this.shared=new Map();this.closed=false;this.failure=null;
    this.worker.on('message',message=>{
      const job=this.pending.get(message.id);if(!job)return;
      this.pending.delete(message.id);
      if(message.ok)job.resolve(message.result);else job.reject(Error(message.error));
    });
    const fail=error=>{this.failure=error;for(const job of this.pending.values())job.reject(error);this.pending.clear();};
    this.worker.on('error',fail);
    this.worker.on('exit',code=>fail(Error(this.closed?'MONITOR_SNAPSHOT_CLOSED':'MONITOR_SNAPSHOT_EXIT:'+code)));
  }
  read(args){
    if(this.closed||this.failure)return Promise.reject(this.failure??Error('MONITOR_SNAPSHOT_CLOSED'));
    const key=JSON.stringify(args);if(this.shared.has(key))return this.shared.get(key);
    const id=++this.sequence;
    const job=new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});
      try{this.worker.postMessage({id,args});}catch(error){this.pending.delete(id);reject(error);}})
      .finally(()=>this.shared.delete(key));
    this.shared.set(key,job);return job;
  }
  async close(){
    if(this.closing)return this.closing;
    this.closed=true;
    // Only this read-only thread may be terminated; it owns no input or leases.
    this.closing=this.worker.terminate();await this.closing;
  }
}

if(!isMainThread){
  const {readMonitorSnapshot}=await import('./mumu-monitor.mjs');
  const {MumuStore}=await import('./mumu-store.mjs');
  let selectedRoot=null,sourceStore=null;
  parentPort.on('message',({id,args})=>{
    try{
      const root=typeof args.sourceRoot==='string'&&args.sourceRoot?resolve(args.sourceRoot):null;
      if(root!==selectedRoot){selectedRoot=root;sourceStore=null;}
      // Reuse only the selected store's verified-byte cache. load() still reads
      // current bytes every time and returns a separate value for each query.
      if(!sourceStore&&root&&existsSync(join(root,'state.json')))sourceStore=new MumuStore({root});
      parentPort.postMessage({id,ok:true,result:readMonitorSnapshot({...args,sourceStore})});
    }
    catch(error){parentPort.postMessage({id,ok:false,error:error.message});}
  });
}
