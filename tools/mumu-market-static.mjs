import {regionDigest,validateBox} from './adb.mjs';
const exactSpec=(image,spec,reg)=>{try{const t=reg.assets.get(spec?.file);return !!t&&t.width===spec.box.width&&
  t.height===spec.box.height&&t.channels===image.channels&&regionDigest(t)===regionDigest(image,spec.box);}catch{return false;}};
export function registeredMarketStatic(image,spec,reg){
  if(exactSpec(image,spec,reg))return true;
  try{
    const t=reg.assets.get(spec?.file),b=validateBox(spec.box,image.width,image.height);
    if(!t||t.width!==b.width||t.height!==b.height||t.channels<3||image.channels<3)return false;
    const n=b.width*b.height,sums=Array.from({length:3},()=>[0,0,0,0,0]);let absoluteDelta=0;
    for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++)for(let c=0;c<3;c++){
      const a=t.pixels[(y*b.width+x)*t.channels+c],v=image.pixels[((y+b.y)*image.width+x+b.x)*image.channels+c];
      const s=sums[c];s[0]+=a;s[1]+=v;s[2]+=a*a;s[3]+=v*v;s[4]+=a*v;absoluteDelta+=Math.abs(a-v);
    }
    let va=0,vb=0,cov=0;for(const [a,v,aa,bb,av] of sums){va+=aa-a*a/n;vb+=bb-v*v/n;cov+=av-a*v/n;}
    const stdA=Math.sqrt(va/(n*3)),stdB=Math.sqrt(vb/(n*3)),ratio=stdB/stdA;
    return stdA>=10&&stdB>=10&&ratio>=.95&&ratio<=1.05&&cov/Math.sqrt(va*vb)>=.985&&absoluteDelta/(n*3)<=4;
  }catch{return false;}
}
