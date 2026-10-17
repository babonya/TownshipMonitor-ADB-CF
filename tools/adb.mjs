import {inputGeometry,resolvePercentageCommand} from './percentage-coordinates.mjs';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const ADB_VERSION = 'mumu-adb-1';
const fail = code => { throw Error(code); };
const positive = n => Number.isSafeInteger(n) && n > 0;
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10]);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const CRC_TABLE=Uint32Array.from({length:256},(_,byte)=>{
  let value=byte;
  for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);
  return value>>>0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc=(crc>>>8)^CRC_TABLE[(crc^byte)&255];
  return (crc^0xffffffff)>>>0;
}

// Validate the complete PNG before publishing it. No shell redirection or image conversion.
export function decodePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length<57 || !bytes.subarray(0,8).equals(pngHeader)) fail('PNG_INVALID');
  let offset=8, width, height, channels, ended=false, dataStarted=false, dataEnded=false;
  const chunks=[];
  while (offset<bytes.length) {
    if (offset+12>bytes.length) fail('PNG_TRUNCATED');
    const length=bytes.readUInt32BE(offset), end=offset+12+length;
    if (end>bytes.length || length>32*1024*1024) fail('PNG_TRUNCATED');
    const type=bytes.toString('ascii',offset+4,offset+8), data=bytes.subarray(offset+8,end-4);
    if (crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4)) fail('PNG_CRC_MISMATCH');
    if (offset===8 && type!=='IHDR') fail('PNG_INVALID');
    if (type==='IHDR') {
      if (width!==undefined || length!==13) fail('PNG_INVALID');
      width=data.readUInt32BE(0); height=data.readUInt32BE(4);
      channels=data[9]===6?4:data[9]===2?3:data[9]===0?1:0;
      if (!positive(width) || !positive(height) || !channels || data[8]!==8 || data[10] || data[11] || data[12]) fail('PNG_UNSUPPORTED_FORMAT');
      if (width*height*channels>64*1024*1024) fail('PNG_TOO_LARGE');
    } else if (type==='IDAT') {
      if (dataEnded) fail('PNG_INVALID');
      dataStarted=true; chunks.push(data);
    } else {
      if (dataStarted) dataEnded=true;
      if (type==='IEND') {
        if (length || !chunks.length || end!==bytes.length) fail('PNG_INVALID');
        ended=true; break;
      }
      if ((bytes[offset+4]&32)===0 && !['PLTE'].includes(type)) fail('PNG_UNKNOWN_CRITICAL_CHUNK');
    }
    offset=end;
  }
  if (!ended) fail('PNG_TRUNCATED');
  const stride=width*channels, expected=height*(stride+1);
  let raw; try { raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:expected}); } catch { fail('PNG_DECODE_FAILED'); }
  if (raw.length!==expected) fail('PNG_DECODE_FAILED');
  const pixels=Buffer.alloc(width*height*channels);
  for (let y=0;y<height;y++) {
    const row=y*(stride+1), filter=raw[row];
    if (filter>4) fail('PNG_FILTER_INVALID');
    for (let x=0;x<stride;x++) {
      const i=y*stride+x, a=x>=channels?pixels[i-channels]:0, b=y?pixels[i-stride]:0, c=y && x>=channels?pixels[i-stride-channels]:0;
      let prediction=0;
      if (filter===1) prediction=a;
      if (filter===2) prediction=b;
      if (filter===3) prediction=Math.floor((a+b)/2);
      if (filter===4) { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); prediction=pa<=pb && pa<=pc?a:pb<=pc?b:c; }
      pixels[i]=(raw[row+1+x]+prediction)&255;
    }
  }
  return {width,height,channels,pixels};
}

export function validateBox(box,width,height) {
  if (!box || ![box.x,box.y,box.width,box.height].every(Number.isSafeInteger) || box.x<0 || box.y<0 || box.width<=0 || box.height<=0 || box.x+box.width>width || box.y+box.height>height) fail('REGION_OUT_OF_BOUNDS');
  return box;
}

export function regionDigest(image,box={x:0,y:0,width:image.width,height:image.height}) {
  validateBox(box,image.width,image.height);
  const hash=createHash('sha256');
  for(let y=box.y;y<box.y+box.height;y++) hash.update(image.pixels.subarray((y*image.width+box.x)*image.channels,(y*image.width+box.x+box.width)*image.channels));
  return hash.digest('hex');
}

export function runProcess(executable,args,{timeoutMs=15000,maxBytes=32*1024*1024,signal=null,onStderr=null,onStdout=null}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('PROCESS_ABORTED'));return;}
    const child=spawn(executable,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const out=[],err=[];let size=0,errSize=0,settled=false,aborted=false;
    const abort=()=>{aborted=true;child.kill();};
    const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{child.kill();done(Error('PROCESS_TIMEOUT'));},timeoutMs);
    child.on('error',error=>done(error));
    child.stdout.on('data',b=>{if(onStdout)onStdout(b);size+=b.length;if(size>maxBytes){child.kill();done(Error('PROCESS_OUTPUT_LIMIT'));}else out.push(b);});
    child.stderr.on('data',b=>{if(onStderr)onStderr(b);if(errSize<8192)err.push(b.subarray(0,8192-errSize));errSize+=b.length;});
    child.on('close',code=>done(aborted?Error('PROCESS_ABORTED'):code===0?null:Error('PROCESS_FAILED:'+code),{stdout:Buffer.concat(out),stderr:Buffer.concat(err).toString('utf8')}));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}

export class AdbDevice {
  constructor({executable,serial,packageName='com.playrix.township',runner=runProcess}={}) {
    if (typeof executable!=='string' || !executable || typeof serial!=='string' || !/^[A-Za-z0-9_.:-]+$/.test(serial) || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) fail('ADB_TARGET_REQUIRED');
    this.executable=executable;this.serial=serial;this.packageName=packageName;this.runner=runner;this.inputBusy=false;
  }
  async command(args,options) { return this.runner(this.executable,['-s',this.serial,...args],options); }
  async assertTarget({signal=null}={}) {
    if(signal?.aborted)fail('CAPTURE_CANCELLED');
    const state=(await this.command(['get-state'],{signal})).stdout.toString('utf8').trim();
    if(signal?.aborted)fail('CAPTURE_CANCELLED');
    if(state!=='device')fail('ADB_DEVICE_NOT_READY');
    const window=(await this.command(['shell','dumpsys','window'],{signal})).stdout.toString('utf8');
    if(signal?.aborted)fail('CAPTURE_CANCELLED');
    const focused=window.split(/\r?\n/).filter(line=>/mCurrentFocus=/.test(line));
    const escaped=this.packageName.replaceAll('.','\\.');
    if(focused.length!==1 || !new RegExp('(?:\\s|\\{)'+escaped+'/').test(focused[0]))fail('ADB_TARGET_NOT_FOREGROUND');
  }
  async capture({signal=null}={}) {
    await this.assertTarget({signal});
    if(signal?.aborted)fail('CAPTURE_CANCELLED');
    const startedAt=new Date().toISOString();
    const {stdout}=await this.command(['exec-out','screencap','-p'],{signal});
    if(signal?.aborted)fail('CAPTURE_CANCELLED');
    const image=decodePng(stdout);
    await this.assertTarget({signal});
    if(signal?.aborted)fail('CAPTURE_CANCELLED');
    return {bytes:stdout,image,startedAt,observedAt:new Date().toISOString(),serial:this.serial,packageName:this.packageName};
  }
  async navigate(action,{width,height,beforeInput=null,coordinates}={}) {
    if(this.inputBusy)fail('ADB_INPUT_BUSY');
    if(!positive(width) || !positive(height))fail('FRAME_DIMENSIONS_REQUIRED');
    action=resolvePercentageCommand(coordinates,inputGeometry({provider:'mumu_adb'},{width,height}),action);
    const point=(x,y)=>Number.isSafeInteger(x) && Number.isSafeInteger(y) && x>=0 && y>=0 && x<width && y<height;
    let args;
    if(action?.type==='tap' && point(action.x,action.y))args=['shell','input','tap',String(action.x),String(action.y)];
    else if(action?.type==='swipe' && point(action.x1,action.y1) && point(action.x2,action.y2) && Number.isSafeInteger(action.durationMs) && action.durationMs>=200 && action.durationMs<=2000)args=['shell','input','swipe',...[action.x1,action.y1,action.x2,action.y2,action.durationMs].map(String)];
    else fail('NAVIGATION_INVALID');
    this.inputBusy=true;
    try{await this.assertTarget();if(beforeInput)await beforeInput();await this.command(args);return {commandIssued:true,gameResultVerified:false};}
    finally{this.inputBusy=false;}
  }
}
