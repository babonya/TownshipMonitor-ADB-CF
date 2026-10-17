import { readFileSync } from 'node:fs';
const file=new URL('../reference/product-catalog.json',import.meta.url);
export function itemReference({query,limit=8}={}){
  if(typeof query!=='string' || !query.trim() || !Number.isSafeInteger(limit) || limit<1 || limit>20)throw Error('ITEM_REFERENCE_REQUEST_INVALID');
  const c=JSON.parse(readFileSync(file,'utf8')),q=query.trim().toLowerCase(),items=c.items??c.products??[];
  const exact=items.filter(i=>[i.itemId,i.referenceKey,i.nameEn].some(s=>typeof s==='string' && s.toLowerCase()===q));
  const matches=exact.length?exact:items.filter(i=>[i.itemId,i.referenceKey,i.nameEn,...(i.runtimeAliasCandidates??[])].some(s=>typeof s==='string' && s.toLowerCase().includes(q)));
  return {referenceOnly:true,currentInventoryVerified:false,levelFilter:c.levelFilter??null,
    items:matches.slice(0,limit).map(i=>({itemId:i.itemId??null,referenceKey:i.referenceKey??null,nameEn:i.nameEn,groupEn:i.groupEn,category:i.category,imageUrl:i.imageUrl??null,runtimeAliasCandidates:i.runtimeAliasCandidates??[]})),
    unresolved:(c.unresolvedRuntimeIds??[]).filter(i=>i.itemId===query),
    warning:'참고 이름/그림을 현재 원본과 대조한다. null ID와 alias 후보를 확정하지 않으며 재고·생산시간을 추정하지 않는다.'};
}
