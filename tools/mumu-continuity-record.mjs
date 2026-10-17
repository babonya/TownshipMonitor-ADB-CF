import {executionReleaseId} from './mumu-execution-release.mjs';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {sameRootPath} from './mumu-path-identity.mjs';
export const CONTINUITY_VERSION='township-continuity-1';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));
const fail=code=>{throw Error(code);};
export function continuityRelease(){return executionReleaseId();}
export function readContinuity(store){
  const file=join(store.root,'.management','continuity.json');if(!existsSync(file))return {version:CONTINUITY_VERSION,status:'not_started',executionAllowed:false};
  const envelope=JSON.parse(readFileSync(file,'utf8'));
  if(envelope.version!==CONTINUITY_VERSION||envelope.checksum!==sha(envelope.record)||
      !sameRootPath(envelope.record.sourceRoot,store.root)||envelope.record.sessionId!==store.load().session.id)fail('CONTINUITY_INTEGRITY_ERROR');
  return {...envelope.record,executionAllowed:false};
}
