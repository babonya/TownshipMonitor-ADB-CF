// Pure raster operation; importing it must not load input or workflow code.
import {deflateSync} from 'node:zlib';
import {crc32,validateBox} from './adb.mjs';
export function cropPng(image,box){
  validateBox(box,image.width,image.height);
  const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
  const h=Buffer.alloc(13);h.writeUInt32BE(box.width);h.writeUInt32BE(box.height,4);h[8]=8;h[9]=image.channels===4?6:image.channels===3?2:0;
  const stride=box.width*image.channels,raw=Buffer.alloc((stride+1)*box.height);
  for(let row=0;row<box.height;row++)image.pixels.copy(raw,row*(stride+1)+1,((box.y+row)*image.width+box.x)*image.channels,((box.y+row)*image.width+box.x+box.width)*image.channels);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
