import {inputGeometry} from './percentage-coordinates.mjs';
import {supportedWindowsGeometry} from './mumu-perception-bridge.mjs';
// A new geometry can invalidate observations, but can never repair a viewport,
// settle an input, resize recognition or reuse a historical click.
export function inspectDeliveryGeometry(c,frame){
  const state=c.store.load();if(state.session?.provider!=='google_play_windows')return null;
  const {isForeground,...target}=frame.captureTarget??{};
  const key=JSON.stringify({width:frame.width,height:frame.height,target,viewport:state.session.windowsViewport});
  if(c.deliveryGeometryKey&&c.deliveryGeometryKey!==key)c.geometryRecheckRequired=true;
  c.deliveryGeometryKey=key;
  if(!supportedWindowsGeometry(frame)){
    c.geometryRecheckRequired=true;return 'GOOGLE_PLAY_PROFILE_REQUIRED';
  }
  try{inputGeometry(state.session,frame);}catch(error){c.geometryRecheckRequired=true;return error.message;}
  return null;
}
