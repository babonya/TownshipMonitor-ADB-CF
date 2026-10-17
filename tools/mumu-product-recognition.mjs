// Shared identity evidence is advisory until its item/context is calibrated.
import {readFileSync,statSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './adb.mjs';
import {PerceptionWorker,helicopterWorkerOptions} from './mumu-perception-bridge.mjs';
const manifestFile=fileURLToPath(new URL('../reference/product-upper-crops/manifest.json',import.meta.url));
const thresholdFile=fileURLToPath(new URL('../reference/product-recognition/thresholds.json',import.meta.url));
let cache=null;
const identity=file=>{const s=statSync(file);return s.size+':'+s.mtimeMs;};
export function productRecognitionRegistration(){
 if(cache&&cache.files.every(([file,id])=>identity(file)===id))return cache;
 const raw=readFileSync(manifestFile),thresholdRaw=readFileSync(thresholdFile),manifest=JSON.parse(raw),thresholds=JSON.parse(thresholdRaw);
 const health={catalogueManifestSha256:digest(raw),thresholdSha256:digest(thresholdRaw),catalogueVersion:manifest.version,thresholdVersion:thresholds.version};
 if(manifest.schema!==1||thresholds.schema!==1||thresholds.catalogueManifestSha256!==health.catalogueManifestSha256)throw Error('PRODUCT_CATALOGUE_BINDING_CHANGED');
 const files=[[manifestFile,identity(manifestFile)],[thresholdFile,identity(thresholdFile)]];
 for(const spec of manifest.items){const file=resolve(dirname(manifestFile),spec.file);
  if(!file.startsWith(dirname(manifestFile)+'\\')&&!file.startsWith(dirname(manifestFile)+'/'))throw Error('PRODUCT_CROP_PATH_INVALID');
  if(digest(readFileSync(file))!==spec.sha256)throw Error('PRODUCT_CROP_CHANGED');files.push([file,identity(file)]);
 }
 cache={manifest,thresholds,health,files};return cache;
}
export function validateProductDependencies(proof){
 if(!proof)return;
 const {health}=productRecognitionRegistration();
 for(const key of ['catalogueManifestSha256','thresholdSha256'])if(proof[key]!==health[key])throw Error('PRODUCT_RECOGNITION_PROOF_CHANGED');
}
export function confirmedSharedIdentity(result,context){
 if(!result||result.status!=='matched'||!result.itemId)return null;
 const registration=productRecognitionRegistration();validateProductDependencies(result);
 const crop=registration.manifest.items.find(i=>i.itemId===result.itemId),entry=registration.thresholds.items[result.itemId]?.[context];
 return crop&&result.cropHash===crop.sha256&&entry?.calibrationStatus==='saved_screen_calibrated'&&
  result.minimumScore===entry.minimumScore&&result.minimumMargin===entry.minimumMargin&&
  result.matchScore>=entry.minimumScore&&result.scoreMargin>=entry.minimumMargin?result.itemId:null;
}
export async function inspectDeliveryIdentities(evidence,regions,worker=null){
 if(!regions.length)return null;
 const registration=productRecognitionRegistration(),uncalibrated=[],needed=[];
 for(const region of regions){const entry=registration.thresholds.items[region.nativeItemId]?.delivery;
  if(entry&&entry.calibrationStatus!=='saved_screen_calibrated')uncalibrated.push({slotId:region.slotId,...registration.health,status:'uncertain',itemId:null,candidateItemId:null,
   matchScore:null,scoreMargin:null,minimumScore:entry.minimumScore,minimumMargin:entry.minimumMargin,box:null,cropHash:null,reason:'CONTEXT_UNCALIBRATED',calibrationStatus:entry.calibrationStatus});
  else needed.push(region);
 }
 if(!needed.length)return {...registration.health,productIdentities:uncalibrated};
 const supplied=worker&&typeof worker.analyze==='function',owned=!supplied,matcher=supplied?worker:new PerceptionWorker(helicopterWorkerOptions(evidence.frame));
 try{const result=await matcher.analyze(evidence.frame,evidence.bytes,{offline:true,productRegions:needed});
  return {...result,productIdentities:regions.map(r=>[...uncalibrated,...result.productIdentities].find(s=>s.slotId===r.slotId))};}
 finally{if(owned)matcher.close();}
}
export function deliveryIdentityEvidence(reading,results,expected){
 // Native exact scene/product/quantity proof remains mandatory. A shared
 // abstention retains that independently validated native path explicitly.
 if(!results)return null;
 validateProductDependencies(results);
 const identities=results.productIdentities.map(result=>{
  const native=expected.find(n=>n.slotId===result.slotId)?.itemId,shared=confirmedSharedIdentity(result,'delivery');
  if(shared&&shared!==native)throw Error('DELIVERY_SHARED_IDENTITY_CONFLICT');
  return {slotId:result.slotId,itemId:native,identitySource:shared?'wiki_upper_crop':'native_validated_fallback',sharedIdentity:result};
 });
 return {...productRecognitionRegistration().health,identities};
}
