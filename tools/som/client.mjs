import {createHash} from 'node:crypto';
export const sha=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const criteria={same_product:'Same product',different_product:'Different products',uncertain:'Unclear'};
export class SomClient{
  constructor({endpoint='http://127.0.0.1:8087/v1/systemone',fetchImpl=fetch,signal=null}={}){
    if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/v1\/systemone$/.test(endpoint))throw Error('SOM_LOCAL_ENDPOINT_REQUIRED');
    Object.assign(this,{endpoint,fetchImpl,signal});this.cache=new Map();this.calls=0;
  }
  async choice(images,instructions,options,question='decision',{cacheUncertain=true}={}){
    const key=sha({images,instructions,options,question});if(this.cache.has(key))return this.cache.get(key);
    const timeout=AbortSignal.timeout(5000),signal=this.signal?AbortSignal.any([timeout,this.signal]):timeout;
    const start=performance.now();const response=await this.fetchImpl(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal,
      body:JSON.stringify({state:null,images,
        questions:{[question]:{type:'choice',instructions,criteria:options}}})});
    if(!response.ok)throw Error('SOM_HTTP_'+response.status);
    const data=await response.json(),answer=data.answers?.[question];
    if(!answer||!Object.hasOwn(options,answer.choice))throw Error('SOM_RESPONSE_INVALID');
    const result={choice:answer.choice,probabilities:answer.probabilities??null,elapsedMs:performance.now()-start};
    this.calls++;if(this.cache.size>=2048)this.cache.delete(this.cache.keys().next().value);
    if(cacheUncertain||result.choice!=='uncertain')this.cache.set(key,result);return result;
  }
  saleText(image){return this.choice([image],'Is the text SALE?',
    {yes:'Yes',no:'No',uncertain:'Unclear'},'sale_text');}
  dealerButton(image){return this.choice([image],'Is this a blue SEARCH button?',
    {yes:'Yes.',no:'No.',uncertain:'Unclear.'},'dealer_search');}
  match(a,b){return this.choice([a,b],'Do these images show the same specific product, not merely the same general category? Different variants count as different products. Compare the product artwork; ignore quantity numbers, check marks, labels, overlays, background, and scale. If unsure, answer "uncertain".',criteria,'product_match',{cacheUncertain:false});}
  button(image,kind){return this.choice([image],kind==='claim'?'Does this button say CLAIM?':'Is this an X-shaped button?',
    {yes:'Yes',no:'No',uncertain:'Unclear'});}
}
