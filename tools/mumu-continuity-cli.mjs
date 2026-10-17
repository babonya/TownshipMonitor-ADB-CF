import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {MumuStore} from './mumu-store.mjs';
import {InventoryStore} from './mumu-inventory-store.mjs';
import {readContinuity,runContinuingHelicopter,adoptContinuityRelease} from './mumu-continuity.mjs';
try{
  const [root,op,file,...extra]=process.argv.slice(2);
  if(!root||extra.length||!['status','run','adopt_release'].includes(op)||op==='status'&&file||op!=='status'&&!file)throw Error('Usage: node tools/mumu-continuity-cli.mjs SESSION_ROOT status | run REQUEST_JSON | adopt_release REQUEST_JSON');
  const store=new MumuStore({root});let result;
  if(op==='status')result=readContinuity(store);
  else{
    const request=JSON.parse(readFileSync(file==='-'?0:file,'utf8').replace(/^\uFEFF/,''));
    if(typeof request.inventoryRoot!=='string'||!request.inventoryRoot)throw Error('EXISTING_INVENTORY_REQUIRED');
    const state=store.load();
    if(op!=='adopt_release'&&(state.stopCapture||state.stopReader))result={status:'hold',reason:'SESSION_STOPPED',input:state.input,executionAllowed:false};
    else if(!existsSync(join(resolve(request.inventoryRoot),'inventory.json')))throw Error('EXISTING_INVENTORY_REQUIRED');
    else{const inventory=new InventoryStore({source:store,root:request.inventoryRoot,clock:store.clock});
      result=op==='adopt_release'?adoptContinuityRelease(store,inventory,request):await runContinuingHelicopter(store,inventory,request);}
  }
  process.stdout.write(JSON.stringify({ok:true,result},null,2)+'\n');
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');process.exitCode=1;}
