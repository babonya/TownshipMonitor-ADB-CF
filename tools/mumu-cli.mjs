import {dispatchRequest} from './mumu-cli-commands.mjs';
import { readFileSync } from 'node:fs';
import { MumuStore } from './mumu-store.mjs';
const json=path=>JSON.parse(readFileSync(path==='-'?0:path,'utf8').replace(/^\uFEFF/,''));

try{
  const [root,op,arg,...extra]=process.argv.slice(2);
  if(!root || !op || extra.length)throw Error('Usage: node tools/mumu-cli.mjs ROOT init CONFIG_JSON | status | request REQUEST_JSON | frame FRAME_ID');
  const store=new MumuStore({root});let result;
  if(op==='init')result=store.init(json(arg));
  else if(op==='status' && !arg)result=store.status();
  else if(op==='readiness' && !arg)result=(await import('./mumu-readiness.mjs')).readiness(store);
  else if(op==='performance' && !arg)result=(await import('./mumu-performance.mjs')).performanceReport(store);
  else if(op==='frame')result=store.evidence(arg).frame;
  else if(op==='request')result=await dispatchRequest(store,json(arg));
  else throw Error('MUMU_OPERATION_UNSUPPORTED');
  process.stdout.write(JSON.stringify({ok:true,result},null,2)+'\n');
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');process.exitCode=1;}
