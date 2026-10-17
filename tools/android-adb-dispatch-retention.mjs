import {readdirSync,readFileSync,unlinkSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {isUnresolvedAction} from './mumu-input-state.mjs';
const terminal=new Set(['verified','rejected_before_input','externally_superseded','resolved_code_path_audit','superseded_on_restart','superseded_by_observation']);

// Called after the canonical state commit, under its lock. Only outstanding
// dispatches need replay protection; settled/evicted actions cannot pass permits.
// Cleanup failure must not turn an already committed transaction into a failure.
export function pruneAdbDispatch(root,state){
  if(state.session?.provider!=='android_adb')return {removed:0};
  const dir=join(root,'adb-dispatch');let files,removed=0;
  try{files=readdirSync(dir);}catch{return {removed};}
  for(const name of files){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const file=join(dir,name);
    try{
      const before=lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink())continue;
      const bytes=readFileSync(file),record=JSON.parse(bytes);
      if(typeof record.actionId!=='string'||name!==digest(Buffer.from(record.actionId))+'.json')continue;
      const action=state.actions?.[record.actionId];
      if(state.input===record.actionId||action&&(isUnresolvedAction(action)||!terminal.has(action.status)))continue;
      const after=lstatSync(file,{bigint:true});
      if(['dev','ino','ctimeNs','mtimeNs','size'].some(k=>before[k]!==after[k])||!readFileSync(file).equals(bytes))continue;
      unlinkSync(file);removed++;
    }catch{} // Retry on a later commit; never touch unknown or replaced files.
  }
  return {removed};
}
