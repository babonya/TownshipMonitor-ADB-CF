// Android raw screencap (no -p, so the phone skips PNG encoding) converted to PNG on the PC.
// Everything after capture (frames, evidenceHash, Python recognition) keeps receiving PNG bytes.
import {deflateSync} from 'node:zlib';
import {crc32} from './adb.mjs';
const fail=code=>{throw Error(code);};
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const chunk=(type,data)=>{
  const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'ascii');data.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out;
};
// Header: width,height,format (+colorspace on Android 9+) as little-endian uint32, then RGBA_8888 rows.
export function rawScreencapToPng(raw){
  if(!Buffer.isBuffer(raw)||raw.length<12)fail('RAW_SCREENCAP_INVALID');
  const width=raw.readUInt32LE(0),height=raw.readUInt32LE(4),format=raw.readUInt32LE(8);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width>16384||height>16384)fail('RAW_SCREENCAP_INVALID');
  if(format!==1)fail('RAW_SCREENCAP_UNSUPPORTED_FORMAT');
  const stride=width*4,pixelBytes=stride*height,headerBytes=raw.length-pixelBytes;
  if(headerBytes!==12&&headerBytes!==16)fail('RAW_SCREENCAP_SIZE_MISMATCH');
  const rows=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++)raw.copy(rows,y*(stride+1)+1,headerBytes+y*stride,headerBytes+(y+1)*stride);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([PNG_SIGNATURE,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}
