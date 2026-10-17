import {AndroidAdbDevice,androidConfig,validateAndroidPacket} from './android-adb-device.mjs';
import {AdbDevice} from './adb.mjs';
import {WindowsDevice,WINDOWS_PROVIDER,validateWindowsSession,validateWindowsPacket,windowsSerial} from './windows-device.mjs';
export const providerOf=session=>session.provider??'mumu_adb';
export function createDevice(session){
  const provider=providerOf(session);
  if(provider==='android_adb')return new AndroidAdbDevice(session);
  if(provider==='mumu_adb')return new AdbDevice(session);
  if(provider===WINDOWS_PROVIDER)return new WindowsDevice(session);
  throw Error('DEVICE_PROVIDER_UNSUPPORTED');
}
export function deviceConfig(config){
  if(config.provider==='android_adb')return androidConfig(config);
  if(providerOf(config)==='mumu_adb'){new AdbDevice(config);return {executable:config.executable,serial:config.serial,packageName:config.packageName??'com.playrix.township'};}
  const normalized={provider:config.provider,serial:windowsSerial(config.windowsTarget??{}),packageName:'com.playrix.township',
    windowsTarget:config.windowsTarget,windowsBridge:config.windowsBridge,windowsBridgeHash:config.windowsBridgeHash,
    windowsCaptureSize:config.windowsCaptureSize,windowsViewport:config.windowsViewport??null};
  validateWindowsSession(normalized);return structuredClone(normalized);
}
export function validateDevicePacket(session,packet){
  if(packet.serial!==session.serial||packet.packageName!==session.packageName||providerOf(packet)!==providerOf(session))throw Error('CAPTURE_TARGET_MISMATCH');
  if(providerOf(session)==='android_adb')validateAndroidPacket(session,packet);
  if(providerOf(session)===WINDOWS_PROVIDER)validateWindowsPacket(session,packet);
}
