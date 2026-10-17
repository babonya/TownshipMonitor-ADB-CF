import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {JsonlReader} from '../mumu-jsonl-reader.mjs';
import {PendingPerceptionRequests} from '../mumu-perception-pending.mjs';
import {frameMetadata,DEFAULT_PYTHON} from '../mumu-perception-bridge.mjs';
import {sha,SomClient} from './client.mjs';
import {DealerSearch} from './dealer.mjs';
import {applyTextDecisions,orderShortagesKnown} from './text-decisions.mjs';
import {ensureSomServer} from './server.mjs';
export const recoverableSomError=e=>e?.name==='TimeoutError'||e?.message==='fetch failed'||['EPIPE','ECONNRESET','ECONNREFUSED'].includes(e?.code)||
  /^(SOM_VISION_TIMEOUT|SOM_VISION_CLOSED:|SOM_HTTP_(408|429|5\d\d))/.test(e?.message??'');

export class SomWorker{
  constructor({python=DEFAULT_PYTHON,viewport,client=new SomClient(),ensureServer=false,prepareServer=ensureSomServer,spawnProcess=spawn,timeoutMs=8000,maxResponseBytes=12*1024*1024,profile=fileURLToPath(new URL('../../reference/som/profile.json',import.meta.url)),visionScript=fileURLToPath(new URL('./vision.py',import.meta.url))}={}){
    this.dealerSearch=new DealerSearch();
    this.viewport=viewport;this.client=client;this.pending=new PendingPerceptionRequests();this.reader=new JsonlReader({maxBytes:maxResponseBytes});this.timeoutMs=timeoutMs;this.stderr='';this.closed=false;
    this.visionOptions={python,visionScript,profile,spawnProcess,maxResponseBytes};this.recoveryUsed=false;
    this.prepareServer=prepareServer;this.ensureServer=ensureServer;this.startVision();
    if(ensureServer){
      const visionReady=this.ready;
      this.serverAbort=new AbortController();
      const serverReady=Promise.resolve().then(()=>{
        this.serverAbort.signal.throwIfAborted();
        return prepareServer({endpoint:client.endpoint,fetchImpl:client.fetchImpl,signal:this.serverAbort.signal});
      });
      this.ready=Promise.all([visionReady,serverReady]).then(([health])=>health);this.ready.catch(()=>{});
    }
  }
  startVision(){
    const {python,visionScript,profile,spawnProcess,maxResponseBytes}=this.visionOptions;
    this.closed=false;this.health=null;this.reader=new JsonlReader({maxBytes:maxResponseBytes});
    this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});this.ready.catch(()=>{});
    const child=this.child=spawnProcess(python,['-B',visionScript,profile],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.startTimer=setTimeout(()=>this.fail(Error('SOM_VISION_START_TIMEOUT')),10000);
    const current=()=>this.child===child;
    child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{if(current())this.receive(data);});
    child.stderr.setEncoding('utf8');child.stderr.on('data',data=>{if(current())this.stderr=(this.stderr+data).slice(-4000);});
    child.stdin.on('error',e=>{if(current())this.fail(e);});child.on('error',e=>{if(current())this.fail(e);});
    child.on('exit',(code,signal)=>{if(current())this.fail(Error(`SOM_VISION_CLOSED:${code??signal}:${this.stderr}`));});
  }
  async recover(error,{signal}={}){
    if(signal?.aborted||this.recoveryUsed||!recoverableSomError(error))return false;
    this.recoveryUsed=true;const previous=this.health?.registryHash;
    if(this.closed)this.startVision();
    const cancel=()=>this.close();signal?.addEventListener('abort',cancel,{once:true});
    try{
      signal?.throwIfAborted();await this.ready;
      if(this.ensureServer)await this.prepareServer({endpoint:this.client.endpoint,fetchImpl:this.client.fetchImpl,signal});
      signal?.throwIfAborted();
      if(previous&&this.health.registryHash!==previous)throw Error('SOM_REGISTRATION_CHANGED');
      return true;
    }finally{signal?.removeEventListener('abort',cancel);}
  }
  fail(error){
    if(this.closed)return;
    this.closed=true;clearTimeout(this.startTimer);this.reject(error);
    this.serverAbort?.abort(error);
    this.pending.rejectAll(error);this.child.kill();
  }
  receive(data){
    if(this.closed)return;
    try{this.reader.append(data);}catch(error){this.fail(Error('SOM_VISION_RESPONSE_TOO_LARGE',{cause:error}));return;}
    while(true){
      let next;
      try{next=this.reader.next();}catch(error){this.fail(Error('SOM_VISION_PROTOCOL',{cause:error}));return;}
      if(next.done)return;
      const message=next.value;
      if(!message||typeof message!=='object'){this.fail(Error('SOM_VISION_PROTOCOL'));return;}
      if(message.kind==='ready'){
        if(this.health||typeof message.profileHash!=='string'||!message.profileHash){this.fail(Error('SOM_VISION_READY_INVALID'));return;}
        clearTimeout(this.startTimer);
        this.health={registryHash:message.profileHash,templateSetVersion:'som-ui-20261009'};
        this.resolve(this.health);continue;
      }
      const job=this.pending.take(message.id);
      if(!job){this.fail(Error('SOM_VISION_REQUEST_CHANGED'));return;}
      if(message.ok===true&&message.result&&typeof message.result==='object')job.resolve(message.result);
      else job.reject(Error(message.error??'SOM_VISION_RESPONSE_INVALID'));
    }
  }
  pixels(bytes,viewport,dealerEntry=false,retryAmounts=false){
    const id=randomUUID();return new Promise((resolve,reject)=>{
      if(this.closed){reject(Error('SOM_VISION_CLOSED'));return;}
      this.pending.start(id,{resolve,reject},this.timeoutMs,()=>this.fail(Error('SOM_VISION_TIMEOUT')));
      const child=this.child;
      child.stdin.write(JSON.stringify({id,image:bytes.toString('base64'),viewport,dealerEntry,retryAmounts})+'\n',error=>{if(error&&this.child===child)this.fail(error);});
    });
  }
  setPendingAction(action){this.pendingAction=action;}
  async analyze(frame,bytes,{scope='navigation',offline=false}={}){
    await this.ready;if(this.closed)throw Error('SOM_VISION_CLOSED');const meta=frameMetadata(frame);
    if(sha(bytes)!==meta.evidenceHash)throw Error('SOM_FRAME_HASH_MISMATCH');
    const viewport=this.viewport;if(!viewport)throw Error('SOM_VIEWPORT_REQUIRED');
    const searchEntry=this.dealerSearch.enabled();
    const vision=await this.pixels(bytes,viewport,searchEntry,frame.provider==='android_adb'&&this.retryAmounts===true);
    this.retryAmounts=false;
    this.dealerSearch.observe(vision.scene);
    if(vision.dealerSearch){
      if(searchEntry){
        try{vision.dealerSearch.answer=await this.client.dealerButton(vision.dealerSearch.image);}
        catch{delete vision.dealerSearch;}
      }else delete vision.dealerSearch;
    }
    // Button semantics run only on an unexpected panel, not on normal frames.
    if(!vision.barnFull&&!vision.popup&&vision.popupCandidates?.length){
      for(const kind of ['claim','close']){
        for(const candidate of vision.popupCandidates.filter(c=>c.kind===kind)){
          const answer=await this.client.button(candidate.image,kind);
          if(answer.choice==='yes'){
            const p={kind,box:candidate.box,hash:candidate.hash,contextHash:kind==='close'?candidate.hash:vision.panelHeaderHash,panelContextHash:vision.panelHeaderHash,region:candidate.region,answer};
            if(kind==='close'&&vision.popup?.kind==='claim')vision.popupClose=p;else vision.popup=p;
            break;
          }
        }
      }
    }
    delete vision.popupCandidates;
    await applyTextDecisions(vision,this.client,meta,this.pendingAction);
    if(frame.provider==='android_adb'&&vision.scene==='helicopter'&&!vision.refreshing&&!vision.minigame){
      if(!orderShortagesKnown(vision)&&this.quantityRetryOrder!==vision.orderHash){this.quantityRetryOrder=vision.orderHash;this.retryAmounts=true;}
      else if(orderShortagesKnown(vision))this.quantityRetryOrder=null;
    }else if(['town','market','barn'].includes(vision.scene))this.quantityRetryOrder=null;
    this.recoveryUsed=false;
    return {schema:1,...meta,...this.health,scope,status:'candidate',coordinateState:offline?'offline':'fresh',scene:{kind:vision.scene},detections:[],
      executionAllowed:false,requiresGptReview:true,ocrRequested:false,som:{schema:1,provider:frame.provider,viewport,profileHash:this.health.registryHash,...vision,
        captureSize:{...meta.dimensions},captureSerial:frame.serial,
        sourceObservation:{frameId:meta.frameId,evidenceHash:meta.evidenceHash}}};
  }
  close(){this.fail(Error('SOM_WORKER_CLOSED'));}
}
