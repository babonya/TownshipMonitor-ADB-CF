// Immutable receipt segments. The inventory checkpoint publishes the head only
// after its segment is durable. An interrupted publication leaves a harmless
// unreferenced segment, never a missing idempotency receipt.
import {existsSync,readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {digest} from './adb.mjs';
import {fileIdentity,readStableFile} from './mumu-file-identity.mjs';
export const INVENTORY_JOURNAL_WINDOW=256;
const hash=x=>digest(Buffer.from(JSON.stringify(x)));
const fail=()=>{throw Error('INVENTORY_JOURNAL_INTEGRITY_ERROR');};
const validReceipt=r=>r&&typeof r.mutationId==='string'&&/^[a-f0-9]{64}$/.test(r.requestHash??'')&&Number.isSafeInteger(r.revision)&&r.revision>0;
function validateHead(head){
  if(head!==null&&(!head||!/^[a-f0-9]{64}$/.test(head.hash??'')||!Number.isSafeInteger(head.count)||head.count<1))fail();
}
const archives=new Map();
function archiveIndex(root,head){
  if(!head)return new Map();
  root=resolve(root);const key=hash(head),cached=archives.get(root);
  const unchanged=files=>{try{return files.every(([file,identity])=>fileIdentity(file)===identity);}catch{return false;}};
  if(cached?.key===key&&unchanged(cached.files))return cached.index;
  archives.delete(root);
  const index=new Map(),files=[];let cursor=head,revision=head.count;
  while(cursor){
    const file=join(root,'operations',cursor.hash+'.json'),{bytes,identity}=readStableFile(file);
    const segment=JSON.parse(bytes.toString('utf8'));
    if(segment.schema!==1||hash(segment)!==cursor.hash||!Array.isArray(segment.operations)||!segment.operations.length)fail();
    validateHead(segment.previous);
    if((segment.previous?.count??0)+segment.operations.length!==cursor.count||cursor.count!==revision)fail();
    for(let n=segment.operations.length-1;n>=0;n--){const r=segment.operations[n];
      if(!validReceipt(r)||r.revision!==revision--||index.has(r.mutationId))fail();
      index.set(r.mutationId,r);
    }
    files.push([file,identity]);cursor=segment.previous;
  }
  if(revision!==0||!unchanged(files))fail();
  if(archives.size>=4)archives.delete(archives.keys().next().value);
  archives.set(root,{key,index,files});return index;
}
export function findInventoryOperation(root,record,mutationId){
  if(!record)return null;
  const head=record.operationsArchive??null;
  validateHead(head);
  const archived=archiveIndex(root,head),receipts=record.operations,seen=new Set();
  let found=archived.get(mutationId)??null,revision=(head?.count??0)+receipts.length;
  if(revision!==record.revision)fail();
  for(let n=receipts.length-1;n>=0;n--){const r=receipts[n];
    if(!validReceipt(r)||r.revision!==revision--||seen.has(r.mutationId)||archived.has(r.mutationId))fail();
    seen.add(r.mutationId);if(r.mutationId===mutationId)found=r;
  }
  if(revision!==(head?.count??0))fail();
  return found?structuredClone(found):null;
}
export function checkpointInventoryOperations(root,record){
  if(record.operations.length<=2*INVENTORY_JOURNAL_WINDOW)return;
  // Migrate legacy checkpoints too. Retain a fixed recent window without
  // deleting any old IDs, result references, or request hashes.
  const archived=record.operations.slice(0,-INVENTORY_JOURNAL_WINDOW);
  let previous=record.operationsArchive??null;
  for(let offset=0;offset<archived.length;offset+=INVENTORY_JOURNAL_WINDOW){
    const operations=archived.slice(offset,offset+INVENTORY_JOURNAL_WINDOW);
    const segment={schema:1,previous,operations},key=hash(segment),dir=join(root,'operations'),file=join(dir,key+'.json');
    mkdirSync(dir,{recursive:true});
    const bytes=JSON.stringify(segment)+'\n';
    if(existsSync(file)){if(readFileSync(file,'utf8')!==bytes)fail();}
    else {const fd=openSync(file,'wx');try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
    previous={hash:key,count:(previous?.count??0)+operations.length};
  }
  record.operationsArchive=previous;
  record.operations=record.operations.slice(-INVENTORY_JOURNAL_WINDOW);
}
