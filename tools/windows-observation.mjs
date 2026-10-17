import {frameMetadata,PerceptionWorker,helicopterWorkerOptions,supportedWindowsGeometry,currentWindowsGeometry} from './mumu-perception-bridge.mjs';
import {decodePng} from './adb.mjs';
import {readTransportNavigation,transportNavigationProfile} from './mumu-transport-navigation-proof.mjs';
// Recognition stays in physical original coordinates. Unregistered geometry/scenes abstain.
export class WindowsObservationWorker{
  constructor(){this.health={registryHash:'google-play-unregistered-v1',templateSetVersion:'google-play-unregistered-v1'};this.ready=Promise.resolve(this.health);}
  async analyze(frame,bytes,{scope='navigation',offline=false}={}){
    const meta=frameMetadata(frame);
    if(supportedWindowsGeometry(frame)){
      const key=JSON.stringify(meta.dimensions);
      if(this.worker&&this.workerKey!==key){this.worker.close();this.worker=null;}
      this.workerKey=key;
      this.worker??=new PerceptionWorker(helicopterWorkerOptions(frame));
      this.health=await this.worker.ready;
      const result=await this.worker.analyze(frame,bytes,{scope,offline});
      if(result.status==='stale'||result.coordinateState==='stale'||result.scene?.kind==='helicopter')return result;
      if(currentWindowsGeometry(frame))return result;
      const image=decodePng(bytes),profile=transportNavigationProfile({provider:'google_play_windows'});
      const scenes=['town','train','airport'].filter(kind=>readTransportNavigation(image,kind,profile).supported);
      if(scenes.length!==1)return result;
      const kind=scenes[0],mismatch=!['unknown',kind].includes(meta.expectedKind);
      return {...result,status:mismatch?'blocked':'candidate',reason:mismatch?'SCENE_HINT_MISMATCH':null,
        scene:{kind},coordinateState:offline?'offline':'fresh'};
    }
    return {schema:1,...meta,...this.health,scope,status:'unsupported',
    reason:'GOOGLE_PLAY_PROFILE_REQUIRED',coordinateState:'unavailable',scene:{kind:'unknown'},detections:[],
    executionAllowed:false,requiresGptReview:true,ocrRequested:false};}
  close(){this.worker?.close();}
}
