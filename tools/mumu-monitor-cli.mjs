import {createInterface} from 'node:readline';
import {MonitorController,readMonitorSnapshot} from './mumu-monitor.mjs';
import {MonitorSnapshotReader} from './mumu-monitor-snapshot.mjs';

// The same snapshot is consumed by the native UI and command-line AI callers.
const emit=value=>{if(!process.stdout.destroyed)process.stdout.write(JSON.stringify(value)+'\n');};
process.stdout.on('error',()=>{});
if(process.argv[2]==='--bridge'){
  const controller=new MonitorController({snapshotReader:new MonitorSnapshotReader(),onEvent:event=>emit({event})});
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  const inflight=new Set();let closing=false,shutdownOptions={},connection=null;
  async function dispatch(line){
    let request;
    try{
      if(Buffer.byteLength(line)>65536)throw Error('MONITOR_REQUEST_TOO_LARGE');request=JSON.parse(line);
      if(!Number.isSafeInteger(request.id)||!request.op)throw Error('MONITOR_REQUEST_INVALID');
      if(closing)throw Error('MONITOR_SHUTTING_DOWN');
      let result;
      if(connection)await connection;
      if(request.op==='connect'){
        connection=Promise.resolve(controller.connect(request.args));
        try{result=await connection;}finally{connection=null;}
      }
      else if(request.op==='status')result=await controller.status(request.args??{});
      else if(request.op==='set_delivery_options')result=await controller.setDeliveryOptions(request.args);
      else if(request.op==='set_workflow_mode')result=await controller.setWorkflowMode(request.args);
      else if(request.op==='start')result=await controller.start(request.args);
      else if(request.op==='pause')result=await controller.pause();
      else if(request.op==='resolve_minigame')result=await controller.resolveMinigame();
      else if(request.op==='shutdown'){closing=true;try{shutdownOptions=request.args??{};result=await controller.shutdown(shutdownOptions);lines.close();}catch(error){closing=false;shutdownOptions={};throw error;}}
      else throw Error('MONITOR_OPERATION_UNSUPPORTED');
      emit({id:request.id,ok:true,result});
    }catch(error){emit({id:request?.id??null,ok:false,error:error.message});}
  }
  lines.on('line',line=>{const task=dispatch(line);inflight.add(task);task.finally(()=>inflight.delete(task));});
  lines.on('close',async()=>{closing=true;await Promise.allSettled([...inflight]);await controller.shutdown(shutdownOptions).catch(()=>{});await controller.wait();process.stdin.destroy();});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>lines.close());
}else{
  try{
    const [sourceRoot,op,inventoryRoot,...extra]=process.argv.slice(2);
    if(op!=='status'||extra.length)throw Error('Usage: node tools/mumu-monitor-cli.mjs SOURCE_ROOT status [INVENTORY_ROOT] | --bridge');
    emit({ok:true,result:readMonitorSnapshot({sourceRoot,inventoryRoot})});
  }catch(error){emit({ok:false,error:error.message});process.exitCode=1;}
}
