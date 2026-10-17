import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha} from './client.mjs';
let permanent;
export function permanentFailedProducts(){
  if(!permanent){
    const file=fileURLToPath(new URL('../../reference/som/permanent-failed-products.json',import.meta.url));
    const registry=JSON.parse(readFileSync(file,'utf8')),root=dirname(file);
    if(registry.schema!==1||sha(readFileSync(join(root,registry.source.file)))!==registry.source.sha256)throw Error('PERMANENT_FAILED_PRODUCT_SOURCE_INVALID');
    permanent=registry.products.map(p=>{
      const bytes=readFileSync(join(root,p.file));
      if(sha(bytes)!==p.sha256)throw Error('PERMANENT_FAILED_PRODUCT_IMAGE_INVALID');
      const image='data:image/png;base64,'+bytes.toString('base64');
      return {id:p.id,hash:sha(image),image,imageFile:join(root,p.file),imageSha256:p.sha256,variants:[],source:{frameId:registry.source.frameId,evidenceHash:registry.source.sha256,
        dimensions:registry.source.dimensions,region:p.region,space:'capture',unit:'fraction'},
        permanent:true,failures:0,searchFailures:0,lastAbsentVisit:null,failed:true,reason:'permanent_failed_product',pending:[]};
    });
  }
  return structuredClone(permanent);
}
// Review-only artwork archive. No reader restores it as live session state.
export function failedProductArchive(root=fileURLToPath(new URL('../../',import.meta.url))){
  return p=>{
    if(!/^data:image\/png;base64,/.test(p.image))throw Error('FAILED_PRODUCT_IMAGE_REQUIRED');
    const dir=join(root,'실패상품','시장',p.sessionId);mkdirSync(dir,{recursive:true});
    const name=sha(p.image),file=join(dir,name+'.png');
    if(!existsSync(file))writeFileSync(file,Buffer.from(p.image.split(',')[1],'base64'));
    writeFileSync(join(dir,name+'.json'),JSON.stringify({schema:1,reviewOnly:true,hash:p.hash,source:p.source,reason:p.reason,failures:p.failures,searchFailures:p.searchFailures??0,sessionId:p.sessionId,recordedAt:new Date().toISOString()},null,2));
  };
}
