import {appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

const timestamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});

// An append-only timing log. It is never read to restore or authorize a pause.
export function recordMinigameEvent(store,event){
  const directory=join(store.root,'.monitor');mkdirSync(directory,{recursive:true});
  const record={event,at:timestamp.format(new Date(store.clock()))};
  appendFileSync(join(directory,'minigame-events.jsonl'),JSON.stringify(record)+'\n','utf8');
  return record;
}
