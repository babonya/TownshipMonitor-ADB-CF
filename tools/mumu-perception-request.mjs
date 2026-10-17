// One operation per request; this projection never owns a worker or input.
export function perceptionRequest(mode,{fields,scene,layoutId,scope='all',helicopter=false,helicopterInfo=false,market=false,barnSale=false,productRegions=null,customerIconsOnly=false}={}) {
  if(!['matching','ocr'].includes(mode))throw Error('PERCEPTION_MODE_INVALID');
  if([helicopter,helicopterInfo,market,barnSale,customerIconsOnly].some(value=>typeof value!=='boolean'))throw Error('PERCEPTION_OPERATION_INVALID');
  if(!['all','navigation'].includes(scope))throw Error('MATCHING_SCOPE_INVALID');
  if(customerIconsOnly&&!helicopter)throw Error('CUSTOMER_ICON_SCOPE_INVALID');
  const operations=[helicopterInfo,market,barnSale,productRegions!==null,helicopter,!!layoutId].filter(Boolean).length;
  if(operations>1||operations&&scope!=='all'||mode==='ocr'&&operations||mode==='matching'&&(fields!==undefined||scene!==undefined))throw Error('PERCEPTION_OPERATION_CONFLICT');
  if(mode==='ocr'){
    if(!Array.isArray(fields)||!fields.length)throw Error('OCR_FIELDS_REQUIRED');
    return structuredClone({op:'ocr',fields,scene});
  }
  if(helicopterInfo)return {op:'helicopter_info',helicopterInfo:true};
  if(barnSale)return {op:'barn_sale',barnSale:true};
  if(market)return {op:'market',market:true};
  if(productRegions!==null)return structuredClone({op:'product_regions',productRegions});
  if(helicopter)return {op:'helicopter',helicopter:true,customerIconsOnly};
  if(layoutId)return {op:'match_slots',layoutId};
  return {op:'match',scope};
}
