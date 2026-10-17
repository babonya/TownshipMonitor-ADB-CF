import {createHash} from 'node:crypto';

// Hash and persist the very same compact state encoding; the wire shape is unchanged.
export function serializeStateEnvelope(version,state){
  const stateJson=JSON.stringify(state),stateBytes=Buffer.from(stateJson);
  const checksum=createHash('sha256').update(stateBytes).digest('hex');
  const prefix=JSON.stringify({version,checksum}).slice(0,-1)+',"state":';
  return {stateJson,bytes:Buffer.concat([Buffer.from(prefix),stateBytes,Buffer.from('}')])};
}
