import {readFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {digest,decodePng} from './adb.mjs';
const fail=code=>{throw Error(code);};
export function rejectedPreflight(store,action,frame){
  const evidence=action.preflightEvidence;
  if(evidence===undefined)return;
  const start=Date.parse(evidence?.captureStartedAt),observed=Date.parse(evidence?.observedAt),finished=Date.parse(action.finishedAt);
  if(!evidence||!/^preflight-[0-9a-f-]{36}$/.test(evidence.id??'')||
      evidence.source!=='screen_observation'||evidence.provider!==(frame.provider??'mumu_adb')||
      evidence.actionId!==action.id||evidence.sourceFrameId!==frame.id||evidence.epoch!==action.epoch||
      evidence.serial!==frame.serial||evidence.packageName!==frame.packageName||
      !Number.isFinite(start)||!Number.isFinite(observed)||start>observed||observed>finished||
      !/^[a-f0-9]{64}$/.test(evidence.evidenceHash??''))fail('REJECTION_PREFLIGHT_CHANGED');
  try{
    const expected=resolve(store.root,'preflight',evidence.id+'.png');
    if(typeof evidence.evidenceRef!=='string'||resolve(evidence.evidenceRef)!==expected||
        realpathSync(expected)!==join(realpathSync(store.root),'preflight',evidence.id+'.png'))
      fail('REJECTION_PREFLIGHT_CHANGED');
    const bytes=readFileSync(expected);
    if(digest(bytes)!==evidence.evidenceHash)fail('REJECTION_PREFLIGHT_CHANGED');
    const image=decodePng(bytes);
    if(image.width!==evidence.width||image.height!==evidence.height)fail('REJECTION_PREFLIGHT_CHANGED');
  }catch{fail('REJECTION_PREFLIGHT_CHANGED');}
}
