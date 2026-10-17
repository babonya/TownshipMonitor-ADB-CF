// Read-only inventory projection evidence. Recheck original bytes on every
// snapshot; reuse only the dimensions of an already fully decoded content hash.
// Used by display and read-only planning status under its existing source lock.
// Input inspection, reservation writes and inventory commits use full evidence.
import {readFileSync,realpathSync} from 'node:fs';
import {relative,isAbsolute} from 'node:path';
import {decodePng,digest} from './adb.mjs';

const geometry=new Map();
export function snapshotEvidenceStore(store,state){
  const source=Object.create(store),verified=new Map();
  source.load=()=>state;
  source.evidence=frameId=>{
    if(verified.has(frameId))return verified.get(frameId);
    const frame=state.frames[frameId];if(!frame)throw Error('FRAME_NOT_FOUND');
    const file=realpathSync(store.frameFile(frameId)),rel=relative(realpathSync(store.evidenceRoot),file);
    if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('FRAME_OUTSIDE_ROOT');
    const bytes=readFileSync(file),hash=digest(bytes);
    if(hash!==frame.evidenceHash)throw Error('FRAME_HASH_MISMATCH');
    let dimensions=geometry.get(hash);
    if(!dimensions){
      const image=decodePng(bytes);dimensions={width:image.width,height:image.height};
      geometry.set(hash,dimensions);if(geometry.size>128)geometry.delete(geometry.keys().next().value);
    }
    if(dimensions.width!==frame.width||dimensions.height!==frame.height)throw Error('FRAME_GEOMETRY_MISMATCH');
    // Projection callers consume the verified frame metadata, never pixels.
    const result={frame,file};verified.set(frameId,result);return result;
  };
  return source;
}
