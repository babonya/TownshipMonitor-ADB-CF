import {JsonlReader} from './mumu-jsonl-reader.mjs';
import {PendingPerceptionRequests} from './mumu-perception-pending.mjs';
// Perception only: immutable frame bytes in, unreviewed candidates out. No ADB.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {perceptionRequest} from './mumu-perception-request.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const DEFAULT_PYTHON=process.env.TOWNSHIP_TEST_PYTHON??fileURLToPath(new URL('../.venv-perception/Scripts/python.exe',import.meta.url));
export const DEFAULT_REGISTRY=fileURLToPath(new URL('../reference/image-matching/registry.json',import.meta.url));
export const DEFAULT_LAYOUTS=fileURLToPath(new URL('../reference/image-matching/slot-layouts.json',import.meta.url));
export const DEFAULT_HELICOPTER_PROFILE=fileURLToPath(new URL('../reference/image-matching/helicopter/profile.json',import.meta.url));
export const WINDOWS_HELICOPTER_PROFILE=fileURLToPath(new URL('../reference/image-matching/google-play/helicopter/profile.json',import.meta.url));
export const WINDOWS_REGISTRY=fileURLToPath(new URL('../reference/image-matching/google-play/registry.json',import.meta.url));
export const CURRENT_WINDOWS_HELICOPTER_PROFILE=fileURLToPath(new URL('../reference/image-matching/google-play/current-1578/helicopter/profile.json',import.meta.url));
export const CURRENT_WINDOWS_REGISTRY=fileURLToPath(new URL('../reference/image-matching/google-play/current-1578/registry.json',import.meta.url));
export const DEFAULT_MARKET_PROFILE=fileURLToPath(new URL('../reference/market-recognition/profile.json',import.meta.url));
export const currentWindowsGeometry=context=>(context?.width??context?.windowsCaptureSize?.width??context?.dimensions?.width)===1578&&
  (context?.height??context?.windowsCaptureSize?.height??context?.dimensions?.height)===1268;
export const supportedWindowsGeometry=context=>context?.provider==='google_play_windows'&&(currentWindowsGeometry(context)||
  (context?.width??context?.windowsCaptureSize?.width??context?.dimensions?.width)===1114&&(context?.height??context?.windowsCaptureSize?.height??context?.dimensions?.height)===735);
export const helicopterProfilePath=context=>context?.provider==='google_play_windows'?(currentWindowsGeometry(context)?CURRENT_WINDOWS_HELICOPTER_PROFILE:WINDOWS_HELICOPTER_PROFILE):DEFAULT_HELICOPTER_PROFILE;
export const helicopterWorkerOptions=context=>({helicopterProfile:helicopterProfilePath(context),...(context?.provider==='google_play_windows'?{registry:currentWindowsGeometry(context)?CURRENT_WINDOWS_REGISTRY:WINDOWS_REGISTRY}:{})});
const workerFile=fileURLToPath(new URL('./township-perception/worker.py',import.meta.url));
const ocrWorkerFile=fileURLToPath(new URL('./township-perception/ocr_worker.py',import.meta.url));

export function frameMetadata(frame) {
  return {frameId:frame.id??frame.frameId,sequence:frame.sequence,epoch:frame.epoch,evidenceHash:frame.evidenceHash,
    observedAt:frame.observedAt,dimensions:{width:frame.width??frame.dimensions?.width,height:frame.height??frame.dimensions?.height},
    expectedKind:frame.kind??frame.expectedKind??'unknown'};
}

export function validatePerception(result,frame,health,request=null) {
  if(!result || result.schema!==1 || result.executionAllowed!==false || result.requiresGptReview!==true || result.ocrRequested!==false ||
      result.frameId!==frame.frameId || result.sequence!==frame.sequence || result.epoch!==frame.epoch ||
      result.evidenceHash!==frame.evidenceHash || result.observedAt!==frame.observedAt ||
      result.dimensions?.width!==frame.dimensions.width || result.dimensions?.height!==frame.dimensions.height ||
      result.registryHash!==health.registryHash || result.templateSetVersion!==health.templateSetVersion ||
      !Array.isArray(result.detections))throw Error('PERCEPTION_RESULT_CONTRACT_MISMATCH');
  if(request?.layoutId && (result.layoutId!==request.layoutId || result.layoutSetHash!==health.layoutSetHash ||
      !Array.isArray(result.slots)))throw Error('SLOT_RESULT_CONTRACT_MISMATCH');
  if(request?.scope && result.scope!==request.scope)throw Error('MATCHING_SCOPE_CONTRACT_MISMATCH');
  if(request?.helicopter&&(result.helicopterProfileHash!==health.helicopterProfileHash||!Array.isArray(result.slots)||!Array.isArray(result.customers)))throw Error('HELICOPTER_RESULT_CONTRACT_MISMATCH');
  if(request?.helicopterInfo&&(result.helicopterProfileHash!==health.helicopterProfileHash||typeof result.productInfoProfileHash!=='string'||result.status==='candidate'&&!Array.isArray(result.productInfo?.popups)))throw Error('HELICOPTER_INFO_CONTRACT_MISMATCH');
  if(request?.market&&(result.marketProfileHash!==health.marketProfileHash||!Array.isArray(result.rows)))throw Error('MARKET_RESULT_CONTRACT_MISMATCH');
  if(request?.barnSale&&(!result.barnSale||typeof result.barnSale.profileHash!=='string'||!Array.isArray(result.barnSale.rows)))throw Error('BARN_RESULT_CONTRACT_MISMATCH');
  if(request?.productRegions&&!Array.isArray(result.productIdentities))throw Error('PRODUCT_RESULT_CONTRACT_MISMATCH');
  if((request?.helicopter||request?.helicopterInfo)&&health.helicopterCatalogueEnabled!==undefined&&
      (result.helicopterCatalogueEnabled!==health.helicopterCatalogueEnabled||health.helicopterCatalogueEnabled===false&&
        (result.catalogueManifestSha256!==undefined||result.thresholdSha256!==undefined)))throw Error('HELICOPTER_DEPENDENCY_CONTRACT_MISMATCH');
  if(request?.market||request?.productRegions||request?.helicopter&&health.helicopterCatalogueEnabled!==false&&health.catalogueManifestSha256){
    if(result.catalogueManifestSha256!==health.catalogueManifestSha256||result.thresholdSha256!==health.thresholdSha256)throw Error('PRODUCT_DEPENDENCY_CONTRACT_MISMATCH');
  }
  return result;
}

export function validateOcr(result,frame,health,request) {
  if(!result || result.schema!==1 || result.executionAllowed!==false || result.requiresGptReview!==true || result.ocrRequested!==true ||
      result.frameId!==frame.frameId || result.sequence!==frame.sequence || result.epoch!==frame.epoch ||
      result.evidenceHash!==frame.evidenceHash || result.observedAt!==frame.observedAt ||
      result.dimensions?.width!==frame.dimensions.width || result.dimensions?.height!==frame.dimensions.height ||
      result.provider!==health.provider || result.rapidocr!==health.rapidocr || result.onnxruntime!==health.onnxruntime ||
      !Array.isArray(result.fields) || result.scene!==request.scene)throw Error('OCR_RESULT_CONTRACT_MISMATCH');
  if(result.status!=='stale'){
    if(result.fields.length!==request.fields.length)throw Error('OCR_FIELD_CONTRACT_MISMATCH');
    for(const [i,f] of result.fields.entries()){
      const expected=request.fields[i];
      if(f.fieldId!==expected.fieldId || f.kind!==expected.kind || f.itemId!==(expected.itemId??null) || f.slotId!==(expected.slotId??null) ||
          f.scale!==(expected.scale??2) || f.recognitionOnly!==(expected.recognitionOnly??true) || f.identityConfirmed!==false ||
          JSON.stringify(f.box)!==JSON.stringify(expected.box))throw Error('OCR_FIELD_CONTRACT_MISMATCH');
    }
  }
  return result;
}

export class PerceptionWorker {
  constructor({python=DEFAULT_PYTHON,registry=DEFAULT_REGISTRY,layouts=null,helicopterProfile=null,marketProfile=null,catalogueProducts=false,timeoutMs=15000,spawnProcess=spawn,mode='matching'}={}) {
    if(!['matching','ocr'].includes(mode))throw Error('PERCEPTION_MODE_INVALID');this.mode=mode;
    this.timeoutMs=timeoutMs;this.pending=new PendingPerceptionRequests();this.reader=new JsonlReader();this.closed=false;this.health=null;this.stderr='';
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    // Immediately attach a rejection handler; callers still receive the failure.
    this.ready.catch(()=>{});
    const arguments_=mode==='ocr'?['-B',ocrWorkerFile,'--serve']:['-B',workerFile,'--registry',registry,'--serve'];
    if(mode==='matching' && layouts)arguments_.push('--layouts',layouts);
    if(mode==='matching' && helicopterProfile)arguments_.push('--helicopter-profile',helicopterProfile);
    if(mode==='matching' && marketProfile)arguments_.push('--market-profile',marketProfile);
    if(mode==='matching' && catalogueProducts)arguments_.push('--catalogue-products');
    this.child=spawnProcess(python,arguments_,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.startTimer=setTimeout(()=>this.fail(Error('PERCEPTION_START_TIMEOUT')),timeoutMs);
    this.child.stdout.setEncoding('utf8');this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data',data=>{this.stderr=(this.stderr+data).slice(-4000);});
    this.child.stdout.on('data',data=>this.receive(data));
    this.child.stdin.on('error',error=>this.fail(error));
    this.child.on('error',error=>this.fail(error));
    this.child.on('exit',(code,signal)=>this.fail(Error(`PERCEPTION_EXIT:${code??signal}:${this.stderr}`)));
  }
  get buffer(){return this.reader.buffer;}
  set buffer(value){this.reader.buffer=value;}
  fail(error) {
    if(this.closed)return;this.closed=true;clearTimeout(this.startTimer);this.rejectReady(error);
    this.pending.rejectAll(error);
    this.child.kill();
  }
  receive(data) {
    try{this.reader.append(data);}catch(error){this.fail(error);return;}
    while(true){
      let next;try{next=this.reader.next();}catch(error){this.fail(error);return;}
      if(next.done)return;
      const message=next.value;
      if(message.kind==='ready'){
        const valid=this.mode==='ocr'?message.provider==='rapidocr' && message.cpuOnly===true && typeof message.rapidocr==='string':
          typeof message.registryHash==='string' && typeof message.templateSetVersion==='string' && message.ocrRequested===false;
        if(this.health || message.executionAllowed!==false || !valid){this.fail(Error('PERCEPTION_READY_INVALID'));return;}
        this.health=message;clearTimeout(this.startTimer);this.resolveReady(message);continue;
      }
      const job=this.pending.take(message.requestId);
      if(!job){this.fail(Error('PERCEPTION_REQUEST_ID_MISMATCH'));return;}
      if(message.ok!==true){job.reject(Error(message.error??'PERCEPTION_FAILED'));continue;}
      try{job.resolve((this.mode==='ocr'?validateOcr:validatePerception)(message.result,job.frame,this.health,job.request));}catch(error){job.reject(error);}
    }
  }
  async analyze(frame,bytes,{offline=false,fields,scene,layoutId,scope='all',helicopter=false,helicopterInfo=false,market=false,barnSale=false,productRegions=null,customerIconsOnly=false}={}) {
    await this.ready;if(this.closed)throw Error('PERCEPTION_WORKER_CLOSED');
    const metadata=frameMetadata(frame);
    if(!Buffer.isBuffer(bytes) || bytes.length>8*1024*1024 || hash(bytes)!==metadata.evidenceHash)throw Error('PERCEPTION_FRAME_HASH_MISMATCH');
    if(this.mode==='ocr' && this.pending.size>=4)throw Error('OCR_QUEUE_FULL');
    if(this.mode==='ocr' && (!Array.isArray(fields) || !fields.length))throw Error('OCR_FIELDS_REQUIRED');
    if(layoutId && (this.mode!=='matching' || !this.health.layoutIds?.includes(layoutId)))throw Error('LAYOUT_UNSUPPORTED');
    if(!['all','navigation'].includes(scope))throw Error('MATCHING_SCOPE_INVALID');
    if(typeof customerIconsOnly!=='boolean'||customerIconsOnly&&!helicopter)throw Error('CUSTOMER_ICON_SCOPE_INVALID');
    const {op,...fieldRequest}=perceptionRequest(this.mode,{fields,scene,layoutId,scope,helicopter,helicopterInfo,market,barnSale,productRegions,customerIconsOnly});
    const requestId=randomUUID();
    const request=JSON.stringify({op,requestId,frame:metadata,
      imageBase64:bytes.toString('base64'),offline,...fieldRequest??{}})+'\n';
    return new Promise((resolve,reject)=>{
      this.pending.start(requestId,{resolve,reject,frame:metadata,request:fieldRequest},this.timeoutMs,
        ()=>this.fail(Error('PERCEPTION_REQUEST_TIMEOUT')));
      this.child.stdin.write(request,error=>{if(error)this.fail(error);});
    });
  }
  close(){this.fail(Error('PERCEPTION_WORKER_CLOSED'));}
}

export class RapidOcrWorker extends PerceptionWorker {
  constructor(options={}){super({...options,mode:'ocr'});}
}

export class LatestFrameMatcher {
  constructor(worker,{clock=Date.now,ttlMs=2500,onResult=()=>{},onError=()=>{}}={}) {
    this.worker=worker;this.clock=clock;this.ttlMs=ttlMs;this.onResult=onResult;this.onError=onError;
    this.waiting=null;this.running=null;this.latest=null;this.expected=null;this.closed=false;
    this.stats={enqueued:0,replaced:0,completed:0,superseded:0,errors:0};
  }
  enqueue(publication,packet) {
    if(this.closed || !publication?.accepted)return false;
    const frame={...frameMetadata(publication.frame),...(publication.frame.provider?{provider:publication.frame.provider}:{}),
      ...(publication.frame.provider==='android_adb'?{serial:publication.frame.serial,adbTarget:structuredClone(publication.frame.adbTarget)}:{})};
    if(!Buffer.isBuffer(packet?.bytes) || hash(packet.bytes)!==frame.evidenceHash)throw Error('PERCEPTION_PACKET_MISMATCH');
    if(this.expected && (frame.epoch<this.expected.epoch || (frame.epoch===this.expected.epoch && frame.sequence<=this.expected.sequence)))return false;
    this.expected=frame;this.latest=null;
    if(this.waiting)this.stats.replaced++;
    this.waiting={frame,bytes:Buffer.from(packet.bytes)};this.stats.enqueued++;
    if(!this.running)this.running=this.drain();
    return true;
  }
  async drain() {
    // Ensure running is assigned before a synchronously failing fake worker runs.
    await Promise.resolve();
    while(this.waiting && !this.closed){
      const job=this.waiting;this.waiting=null;
      try{
        const result=await this.worker.analyze(job.frame,job.bytes,{scope:'navigation'});
        validatePerception(result,job.frame,this.worker.health,{scope:'navigation'});this.stats.completed++;
        if(this.closed)break;
        if(result.frameId!==this.expected?.frameId || result.sequence!==this.expected?.sequence || result.epoch!==this.expected?.epoch){this.stats.superseded++;continue;}
        const age=this.clock()-Date.parse(result.observedAt);
        this.latest=age>=0 && age<=this.ttlMs && result.status==='candidate' && result.coordinateState==='fresh'?result:null;
        await this.onResult(result);
      }catch(error){
        this.stats.errors++;this.latest=null;
        // Callback failure must not leave the bounded queue permanently busy.
        try{await this.onError(error);}catch{this.closed=true;this.waiting=null;this.worker.close();}
      }
    }
    this.running=null;
  }
  getLatest(){
    if(!this.latest)return null;
    const age=this.clock()-Date.parse(this.latest.observedAt);
    return age>=0 && age<=this.ttlMs?structuredClone(this.latest):null;
  }
  async flush(){while(this.running)await this.running;}
  async close(){this.closed=true;this.waiting=null;this.latest=null;this.worker.close();await this.flush();}
}
