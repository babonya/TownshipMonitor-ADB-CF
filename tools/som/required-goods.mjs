// Read-only presentation of the current temporary shopping images.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha} from './client.mjs';
import {permanentFailedProducts} from './failed-products.mjs';
export function somRequiredGoods(store,state){
  const permanent=state.session.provider==='android_adb'?permanentFailedProducts().map(p=>({id:p.hash,path:p.imageFile,sha256:p.imageSha256,reason:p.reason,failures:0})):[];
  const empty={mode:'som',images:[],failedImages:permanent,executionAllowed:false};
  try{
    const dir=join(store.root,'.monitor','som-needs');
    const data=JSON.parse(readFileSync(join(dir,'current.json'),'utf8'));
    if(data.schema!==1||data.temporary!==true||!Array.isArray(data.images)||data.sessionId!==state.session.id||
      data.incarnation!==(state.orderDemandStartup?.currentIncarnation??null))return empty;
    const readImages=items=>{const images=[];
    for(const item of items){
      if(!/^[a-f0-9]{64}\.png$/.test(item?.file)||item.file!==item.pixelHash+'.png')continue;
      // The session/incarnation binds this temporary list without requiring
      // retained historical frames. A restart invalidates the previous list.
      try{const path=join(dir,item.file),bytes=readFileSync(path);images.push({id:item.pixelHash,path,sha256:sha(bytes),
        ...(item.reason?{reason:item.reason,failures:item.failures}:{})});}catch{}
    }
    return images;};
    const live=data.marketDeadline===null||Number.isFinite(data.marketDeadline)&&data.marketDeadline>(store.clock?.()??Date.now());
    const failed=live&&Array.isArray(data.failedImages)?readImages(data.failedImages):[];
    return {...empty,images:readImages(data.images),failedImages:[...permanent,...failed.filter(p=>!permanent.some(f=>f.id===p.id))],marketSessionId:data.marketSessionId??null};
  }catch{return empty;}
}
