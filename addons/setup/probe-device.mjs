// 기기 정보 읽기(probe): 원작자 tools/android-adb-cli.mjs probe 와 같은 결과 형식의 device.json + device.json.png 를 만든다.
// 터치 입력 없음. 사용: node addons/setup/probe-device.mjs ADB_EXE SERIAL OUTPUT_JSON
// (배포 트리에 tools/android-adb-cli.mjs 가 없어서 대신 둔 파일. 원본이 있으면 처음설정이 그쪽을 쓴다.)
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {AdbDevice} from '../../tools/adb.mjs';
import {inspectAndroid} from '../../tools/android-adb-device.mjs';
try{
  const [exe,serial,out,...extra]=process.argv.slice(2);
  if(!exe||!serial||!out||extra.length)throw Error('Usage: node addons/setup/probe-device.mjs ADB_EXE SERIAL OUTPUT_JSON');
  const executable=resolve(exe),packageName='com.playrix.township';
  const info=await inspectAndroid({executable,serial,packageName});
  const device=new AdbDevice({executable,serial,packageName});
  const shot=await device.capture();
  const {deviceSerial,bootId,displayId,width,height,rotation,physicalDisplayId}=info;
  const pw=shot.bytes.readUInt32BE(16),ph=shot.bytes.readUInt32BE(20);
  if(pw!==width||ph!==height)throw Error("PROBE_CAPTURE_SIZE_MISMATCH "+pw+"x"+ph+" vs "+width+"x"+height);
  const config={provider:'android_adb',executable,serial,packageName,
    adbExecutableHash:createHash('sha256').update(readFileSync(executable)).digest('hex'),
    adbTarget:{deviceSerial,bootId,displayId,width,height,rotation,physicalDisplayId}};
  mkdirSync(dirname(resolve(out)),{recursive:true});
  writeFileSync(resolve(out)+'.png',shot.bytes);
  writeFileSync(resolve(out),JSON.stringify(config,null,2));
  console.log(JSON.stringify({ok:true,serial,width,height,rotation}));
}catch(error){console.error(error.message);process.exitCode=1;}
