import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MumuStore} from './mumu-store.mjs';
import {InventoryStore} from './mumu-inventory-store.mjs';

try{
  const [sourceRoot,sidecarRoot,op,requestFile,...extra]=process.argv.slice(2);
    if(!sourceRoot||!sidecarRoot||extra.length||!(op==='status'&&!requestFile||['init','reserve','sync','release','apply_action','account_action'].includes(op)&&requestFile))
    throw Error('Usage: mumu-inventory-cli.mjs SOURCE_ROOT SIDECAR_ROOT status | init|reserve|sync|release|apply_action|account_action REQUEST_JSON');
  const store=new InventoryStore({source:new MumuStore({root:resolve(sourceRoot)}),root:resolve(sidecarRoot)});
  const result=op==='status'?store.status():store.commit(op,JSON.parse(readFileSync(requestFile,'utf8').replace(/^\uFEFF/,'')));
  process.stdout.write(JSON.stringify({ok:true,result})+'\n');
}catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n');process.exitCode=1;}
