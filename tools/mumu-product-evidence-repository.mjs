import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pruneProductEvidenceImages} from './mumu-image-retention.mjs';
import {digest as hash} from './adb.mjs';
import {atomic} from './mumu-persistence.mjs';
import {fileIdentity,readStableFile} from './mumu-file-identity.mjs';

// Rebuildable metadata index only. Every lookup rechecks file identity and all
// matching PNG hashes; external AI decisions never wait for a cache timeout.
const metadataIndex=new Map();
function productMetadata(file){
  const identity=fileIdentity(file),cached=metadataIndex.get(file);
  if(cached?.identity===identity)return cached.value;
  const stable=readStableFile(file),value=JSON.parse(stable.bytes.toString('utf8'));
  if(metadataIndex.size>=256)metadataIndex.delete(metadataIndex.keys().next().value);
  metadataIndex.set(file,{identity:stable.identity,value});return value;
}

export function writeEvidence(file,bytes){
  if(existsSync(file)){if(hash(readFileSync(file))!==hash(bytes))throw Error('HELICOPTER_INFO_EVIDENCE_CONFLICT');return;}
  writeFileSync(file,bytes,{flag:'wx'});
}
export function completeProductEvidence(root,key){
  if(!existsSync(root))return false;
  let entries;try{entries=readdirSync(root,{withFileTypes:true});}catch{return false;}
  for(const entry of entries){
    if(!entry.isDirectory())continue;
    try{
      const dir=join(root,entry.name),m=productMetadata(join(dir,'metadata.json'));
      if(m.schema===1&&m.evidenceKey===key&&m.status==='complete'&&!['rejected','unreadable'].includes(m.registrationStatus)&&m.returned?.confirmed===true&&
        ['item.png','source.png','info.png'].every(name=>hash(readFileSync(join(dir,name)))===m.files?.[name]))return true;
    }catch{/* An incomplete or changed evidence bundle never suppresses collection. */}
  }
  return false;
}
export function saveProductEvidence(record){
  const file=join(record.directory,'metadata.json');
  // A collector owns collection fields. Never overwrite an AI decision made
  // while the popup result was being observed.
  if(existsSync(file)){
    const latest=productMetadata(file);
    if(latest.evidenceKey!==record.metadata.evidenceKey||latest.source?.evidenceHash!==record.metadata.source?.evidenceHash)
      throw Error('HELICOPTER_INFO_EVIDENCE_CONFLICT');
    for(const key of ['registrationStatus','itemId','registration','registrationHold']){
      if(Object.hasOwn(latest,key))record.metadata[key]=latest[key];else delete record.metadata[key];
    }
  }
  atomic(file,record.metadata);
  record.retention=pruneProductEvidenceImages(dirname(record.directory),{protectedDirectories:[record.directory]});
}

export function createProductEvidence(record,item,source){
  mkdirSync(record.directory,{recursive:true});
  writeEvidence(join(record.directory,'item.png'),item);
  writeEvidence(join(record.directory,'source.png'),source);
  saveProductEvidence(record);
}
export function productEvidenceLocation(root,key,sourceSequence){
  const id=key.slice(0,24)+'-'+sourceSequence.toString(36);
  return {id,directory:join(root,id)};
}
export function loadProductEvidence(root,tag,original){
  const {directory}=productEvidenceLocation(root,tag.evidenceKey,original.sequence);
  return {directory,sourceFrameId:tag.sourceFrameId,slotId:tag.slotId,evidenceKey:tag.evidenceKey,
    gridHash:original.review?.data?.helicopterProductInfo?.gridHash,metadata:JSON.parse(readFileSync(join(directory,'metadata.json'),'utf8'))};
}
export function evidenceFilesMatch(record,names){
  return names.every(name=>hash(readFileSync(join(record.directory,name)))===record.metadata.files?.[name]);
}
