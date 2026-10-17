import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {cropPng} from './png-crop.mjs';
import {atomic} from './mumu-persistence.mjs';
import {productCropBox} from './mumu-helicopter-info-proof.mjs';
import {pruneProductEvidenceImages} from './mumu-image-retention.mjs';

const hash=v=>digest(Buffer.from(JSON.stringify(v)));
function immutable(path,bytes){
  if(existsSync(path)){if(digest(readFileSync(path))!==digest(bytes))throw Error('HELICOPTER_OBSERVATION_EVIDENCE_CHANGED');}
  else writeFileSync(path,bytes,{flag:'wx'});
}
// Pure saved-frame harvesting: never opens a tooltip, identifies a new item,
// changes runtime stock, or authorizes an input. Full originals remain intact.
export function collectHelicopterObservation(root,frame,evidence,matching,profile){
  if(matching?.normalOrderNavigation?.status!=='matched_candidate'||matching.status!=='candidate'||
    frame.width!==profile.dimensions.width||frame.height!==profile.dimensions.height)return null;
  if(digest(evidence.bytes)!==frame.evidenceHash||evidence.image.width!==frame.width||evidence.image.height!==frame.height)
    throw Error('HELICOPTER_OBSERVATION_SOURCE_CHANGED');
  const scope={transport:'helicopter',provider:frame.provider,width:frame.width,height:frame.height};
  const gridHash=digest(cropPng(evidence.image,profile.orderGrid)),orderKey=hash({scope,gridHash});
  const directory=join(root,'observations',orderKey);mkdirSync(directory,{recursive:true});
  const metadataFile=join(directory,'metadata.json');
  let previous=null;
  if(existsSync(metadataFile)){
    previous=JSON.parse(readFileSync(metadataFile,'utf8'));
    if(previous.orderKey!==orderKey||digest(readFileSync(join(directory,'source.png')))!==previous.source.hash)
      throw Error('HELICOPTER_OBSERVATION_EVIDENCE_CHANGED');
    if(previous.status==='complete'){
      for(const item of previous.items){
        if(item.file!==item.file.split(/[\\/]/).at(-1)||digest(readFileSync(join(directory,item.file)))!==item.imageHash)
          throw Error('HELICOPTER_OBSERVATION_EVIDENCE_CHANGED');
      }
      const retention=pruneProductEvidenceImages(root,{protectedDirectories:[directory]});
      return {...previous,directory,reused:true,retention};
    }
  }
  const source=previous?.source??{frameId:frame.id,hash:frame.evidenceHash,observedAt:frame.observedAt};
  // A partial record keeps its original frame binding and is not overwritten.
  if(source.hash!==frame.evidenceHash)throw Error('HELICOPTER_OBSERVATION_PARTIAL_REQUIRES_ORIGINAL');
  immutable(join(directory,'source.png'),evidence.bytes);
  const record={schema:1,orderKey,scope,source,gridHash,status:'pending',purpose:'product_registration_evidence',items:[]};
  atomic(metadataFile,record);
  for(const slot of matching.slots??[]){
    if(slot.status==='empty'||slot.productPresent===false)continue;
    const box=productCropBox(profile,slot.slotId),bytes=cropPng(evidence.image,box),imageHash=digest(bytes);
    const checkState=typeof slot.checkPresent==='boolean'?(slot.checkPresent?'present':'absent'):'unknown';
    const variantKey=hash({scope,width:box.width,height:box.height,imageHash,checkState});
    const file=slot.slotId+'-'+variantKey.slice(0,16)+'.png';immutable(join(directory,file),bytes);
    record.items.push({slotId:slot.slotId,file,imageHash,variantKey,checkState,
      candidateItemId:slot.status==='matched_candidate'?slot.itemId:null,registrationStatus:'pending_ai',
      cropBox:box,percentageCrop:{unit:'fraction',space:'registered_capture',
        x:box.x/frame.width,y:box.y/frame.height,width:box.width/frame.width,height:box.height/frame.height}});
  }
  record.status='complete';atomic(metadataFile,record);
  const retention=pruneProductEvidenceImages(root,{protectedDirectories:[directory]});
  return {...record,directory,reused:false,retention};
}
