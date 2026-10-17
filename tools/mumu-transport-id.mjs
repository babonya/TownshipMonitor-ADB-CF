const categories=Object.freeze({helicopter:'hc',train:'tr',plane:'ap',airport:'ap'});
export const transportAbbreviation=transport=>Object.hasOwn(categories,transport)?categories[transport]:null;

// A category labels the current target/order; it never authorizes an input.
export function targetTransportCategory(frame,target){
  const operation=target?.kind?.match(/_(helicopter|train|airport)$/)?.[1];
  const navigation=target?.transportNavigation;
  const transport=operation??(target?.trainDetail?'train':target?.airportDetail?'airport':
    target?.helicopterSelection||target?.marketTownNavigation?.role==='transport_exit'?'helicopter':null)??
    (navigation?(navigation.to==='town'?navigation.from:navigation.to):null)??
    frame?.review?.data?.order?.transport??frame?.review?.actualKind;
  return transportAbbreviation(transport);
}
