// Scene names and allocation wire names have distinct existing contracts.
export const transportKind=kind=>kind==='plane'?'airport':kind;
export const allocationTransport=kind=>kind==='airport'?'plane':kind;
export const TRANSPORT_PRIORITY=Object.freeze(['airport','train','helicopter']);
export const transportPriority=kind=>{const index=TRANSPORT_PRIORITY.indexOf(transportKind(kind));return index<0?9:index;};
