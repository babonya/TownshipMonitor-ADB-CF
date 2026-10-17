// One invocation owns its worker, matcher and delivery cleanup. The controller
// retains public status fields and the distinct persistent-stop policies.
export class MonitorRunSession{
  constructor(controller,token){
    this.controller=controller;this.token=token;this.workerClosed=false;this.deliveryClosed=false;
    this.abort=controller.abort=new AbortController();
    controller.starting=true;controller.phase='starting';controller.lastError=null;
  }
  current(){return this.token===this.controller.generation;}
  activate(options){
    const c=this.controller;
    c.running=true;c.starting=false;c.phase='running';c.workerOptions=options;
  }
  closeWorker(){if(this.workerClosed)return;this.workerClosed=true;this.worker?.close();}
  closeDelivery(){if(this.deliveryClosed)return;this.deliveryClosed=true;this.delivery?.close();}
  failStartup(error){
    this.abort.abort();
    try{try{this.closeDelivery();}finally{this.closeWorker();}}finally{
      const c=this.controller;c.starting=false;c.running=false;c.phase=this.current()?'error':'paused';c.lastError=error.message;
    }
  }
  finish(results){return this.finishing??=(async()=>{
    const c=this.controller,cleanupErrors=[];
    try{await this.matcher?.flush();}catch(error){cleanupErrors.push(error);}
    try{
      if(this.matcher){this.workerClosed=true;await this.matcher.close();}
      else this.closeWorker();
    }catch(error){cleanupErrors.push(error);}
    try{this.closeDelivery();}catch(error){cleanupErrors.push(error);}
    for(const error of [...results.filter(r=>r.status==='rejected').map(r=>r.reason),...cleanupErrors]){
      c.lastError=error.message;c.emit('error',{error:error.message});
    }
    c.running=false;c.phase=c.lastError?'error':this.abort?.signal.aborted?'paused':'completed';
    c.emit('worker_end',{phase:c.phase});
  })();}
}
