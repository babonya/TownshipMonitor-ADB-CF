import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {atomic} from '../mumu-persistence.mjs';

// Disposable presentation images, separate from input proof and product evidence.
export class NeedImages{
  constructor(root,{writeManifest=atomic}={}){
    this.dir=join(root,'.monitor','som-needs');this.writeManifest=writeManifest;
  }
  save(needs,{frame,state,cycle,failedProducts=[],marketSessionId=null,marketDeadline=null}){
    mkdirSync(this.dir,{recursive:true});
    const file=join(this.dir,'current.json');let previous;
    try{previous=JSON.parse(readFileSync(file,'utf8'));}
    catch(error){if(!(error instanceof SyntaxError)&&error.code!=='ENOENT')throw error;}
    const failed=new Map(failedProducts.map(p=>[p.hash,p]));
    const needed=new Map([...needs].filter(([hash,n])=>!failed.has(hash)&&!failedProducts.some(p=>p.id===n.sessionProductId)));
    const retained=new Set([...needed.keys(),...failed.keys()]);
    for(const n of [...(Array.isArray(previous?.images)?previous.images:[]),...(Array.isArray(previous?.failedImages)?previous.failedImages:[])]){
      if(n&&/^[a-f0-9]{64}\.png$/.test(n.file)&&!retained.has(n.file.slice(0,-4))&&existsSync(join(this.dir,n.file)))
        unlinkSync(join(this.dir,n.file));
    }
    const writeImages=(items)=>{const images=[];
    for(const [hash,n] of items){
      if(!/^[a-f0-9]{64}$/.test(hash))throw Error('SOM_NEED_IMAGE_HASH_INVALID');
      const name=hash+'.png',path=join(this.dir,name);
      if(!existsSync(path))writeFileSync(path,Buffer.from(n.image.split(',')[1],'base64'));
      if(!n.failed)n.source??={frameId:frame.id,evidenceHash:frame.evidenceHash,dimensions:{width:frame.width,height:frame.height},
        region:n.region,space:'capture',unit:'fraction'};
      images.push({file:name,pixelHash:hash,source:n.source,...(n.failed?{reason:n.reason,failures:n.failures}:{})});
    }
    return images;};
    const images=writeImages(needed),failedImages=writeImages(failed);
    const current={schema:1,temporary:true,sessionId:state.session.id,
      incarnation:state.orderDemandStartup?.currentIncarnation??null,cycle,images,failedImages,marketSessionId,marketDeadline};
    // Read each time so a removed/corrupt disposable manifest is repaired, while
    // unchanged observations avoid a durable temp-file write/fsync/rename.
    if(JSON.stringify(previous)!==JSON.stringify(current))this.writeManifest(file,current);
    return current;
  }
}
