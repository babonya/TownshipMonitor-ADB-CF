import {frameMetadata} from './mumu-perception-bridge.mjs';
import {digest,decodePng} from './adb.mjs';
import {fileURLToPath} from 'node:url';
import {SomWorker} from './som/worker.mjs';
export const registeredAndroidGeometry=session=>session?.provider==='android_adb'&&session.adbTarget?.displayId===0&&
  [1544,1600].includes(session.adbTarget.width)&&session.adbTarget.height===720&&session.adbTarget.rotation===90;

export class AndroidSomWorker extends SomWorker{
  constructor(session,options={}){
    if(!registeredAndroidGeometry(session))throw Error('ANDROID_PROFILE_REQUIRED');
    const width=session.adbTarget.width;
    super({...options,viewport:{x:0,y:0,width,height:720},
      profile:fileURLToPath(new URL(`../reference/som/android-${width}/profile.json`,import.meta.url)),
      visionScript:fileURLToPath(new URL('./som/android_vision.py',import.meta.url))});
    this.session=structuredClone(session);
  }
  async analyze(frame,bytes,options){
    const meta=frameMetadata(frame),image=decodePng(bytes),target=this.session.adbTarget;
    if(frame.provider!=='android_adb'||frame.serial!==this.session.serial||
      Object.keys(target).some(k=>frame.adbTarget?.[k]!==target[k])||digest(bytes)!==meta.evidenceHash||
      image.width!==target.width||image.height!==target.height||image.width!==meta.dimensions.width||image.height!==meta.dimensions.height)throw Error('ADB_FRAME_CHANGED');
    return super.analyze(frame,bytes,options);
  }
}
// PC/MuMu registrations are not evidence for the phone's different layout.
export class AndroidObservationWorker{
  constructor(){this.health={registryHash:'android-adb-unregistered-v1',templateSetVersion:'android-adb-unregistered-v1'};this.ready=Promise.resolve(this.health);}
  async analyze(frame,bytes,{scope='navigation'}={}){
    const meta=frameMetadata(frame),image=decodePng(bytes);
    if(digest(bytes)!==meta.evidenceHash||image.width!==meta.dimensions.width||image.height!==meta.dimensions.height)throw Error('ADB_FRAME_CHANGED');
    return {schema:1,...meta,...this.health,scope,status:'unsupported',reason:'ANDROID_PROFILE_REQUIRED',coordinateState:'unavailable',
      scene:{kind:'unknown'},detections:[],executionAllowed:false,requiresGptReview:true,ocrRequested:false};
  }
  close(){}
}
