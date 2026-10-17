import {digest} from './adb.mjs';
// Caller completion and helper termination are independent. In particular,
// timing out an input caller must not terminate its native button cleanup.
export class WindowsBridgeCall{
  constructor(request,startedAt){
    this.caller='pending';this.helper='running';
    this.inputTerminal=request.op==='input'?{op:'input',actionId:request.permit?.actionId??null,stateHash:request.permit?.sha256??null,
      commandHash:digest(Buffer.from(JSON.stringify(request.action??null))),startedAt:new Date(startedAt).toISOString(),closed:false,code:null,signal:null,closedAt:null}:null;
  }
  get settled(){return this.caller==='settled';}
  settle(){if(this.settled)return false;this.caller='settled';return true;}
  exited(){if(this.helper!=='closed')this.helper='exited';}
  closed(code,signal,at=new Date().toISOString()){
    this.helper='closed';
    if(this.inputTerminal)Object.assign(this.inputTerminal,{closed:true,code,signal:signal??null,closedAt:at});
  }
}
export class BoundedBridgeStderr{
  constructor(limit=64*1024){this.limit=limit;this.bytes=0;this.retained=Buffer.alloc(0);}
  append(chunk){
    const b=Buffer.from(chunk);this.bytes+=b.length;
    this.retained=b.length>=this.limit?Buffer.from(b.subarray(-this.limit)):
      Buffer.concat([this.retained.subarray(Math.max(0,this.retained.length+b.length-this.limit)),b]);
  }
  snapshot(){return {stderrBytes:this.bytes,stderrRetainedBytes:this.retained.length,stderrTruncated:this.bytes>this.retained.length,
    stderr:this.retained.toString('utf8'),stderrBase64:this.retained.toString('base64')};}
}
