// Request settlement owns timers; process failure remains the worker's concern.
export class PendingPerceptionRequests extends Map{
  start(requestId,job,timeoutMs,onTimeout){
    const timer=setTimeout(onTimeout,timeoutMs);
    this.set(requestId,{...job,timer});
  }
  take(requestId){
    const job=this.get(requestId);if(!job)return null;
    this.delete(requestId);clearTimeout(job.timer);return job;
  }
  rejectAll(error){
    for(const job of this.values()){clearTimeout(job.timer);job.reject(error);}
    this.clear();
  }
}
