// product_match 사전 거르기: 두 PNG의 가운데 색 분포(HSV 히스토그램)가 확연히 다르면 AI 호출 없이 different_product로 답한다.
// OpenCV 규칙(resize INTER_LINEAR 64x64 -> 가운데 32x32, BGR2HSV 8비트, H30xS32 히스토그램, L2 정규화, Bhattacharyya)을 외부 패키지 없이 재현.
import zlib from 'node:zlib';

export const decodePng=buf=>{
  if(buf.length<33||buf.readUInt32BE(0)!==0x89504e47)throw Error('not png');
  let p=8,w=0,h=0,bd=0,ct=0,il=0,plte=null;const idat=[];
  while(p+8<=buf.length){const len=buf.readUInt32BE(p),type=buf.toString('latin1',p+4,p+8),d=buf.subarray(p+8,p+8+len);
    if(type==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);bd=d[8];ct=d[9];il=d[12];}
    else if(type==='PLTE')plte=d;else if(type==='IDAT')idat.push(d);else if(type==='IEND')break;
    p+=12+len;}
  if(il!==0)throw Error('interlace');
  if(bd!==8||![0,2,3,4,6].includes(ct))throw Error('unsupported png');
  if(ct===3&&!plte)throw Error('no palette');
  const bpp={0:1,2:3,3:1,4:2,6:4}[ct],stride=w*bpp,raw=zlib.inflateSync(Buffer.concat(idat));
  if(raw.length<(stride+1)*h)throw Error('short data');
  const out=Buffer.alloc(stride*h);
  for(let y=0;y<h;y++){const f=raw[y*(stride+1)],s=y*(stride+1)+1,o=y*stride;
    for(let x=0;x<stride;x++){const a=x>=bpp?out[o+x-bpp]:0,b=y?out[o-stride+x]:0,c=(y&&x>=bpp)?out[o-stride+x-bpp]:0,v=raw[s+x];let r;
      switch(f){case 0:r=v;break;case 1:r=v+a;break;case 2:r=v+b;break;case 3:r=v+((a+b)>>1);break;
        case 4:{const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);r=v+((pa<=pb&&pa<=pc)?a:(pb<=pc?b:c));break;}
        default:throw Error('filter');}
      out[o+x]=r&255;}}
  // RGB(3채널) 평면으로
  const rgb=Buffer.alloc(w*h*3);
  for(let i=0;i<w*h;i++){let r,g,b;
    if(ct===2||ct===6){r=out[i*bpp];g=out[i*bpp+1];b=out[i*bpp+2];}
    else if(ct===0||ct===4){r=g=b=out[i*bpp];}
    else{const k=out[i]*3;r=plte[k];g=plte[k+1];b=plte[k+2];}
    rgb[i*3]=r;rgb[i*3+1]=g;rgb[i*3+2]=b;}
  return {w,h,rgb};
};

// cv2.resize INTER_LINEAR (픽셀 중심 정렬, 가장자리 복제, 안티앨리어싱 없음)
const resize=(im,N)=>{const {w,h,rgb}=im,out=new Uint8Array(N*N*3),sx=w/N,sy=h/N;
  for(let y=0;y<N;y++){let fy=(y+0.5)*sy-0.5,y0=Math.floor(fy);fy-=y0;const y1=Math.min(y0+1,h-1);y0=Math.max(y0,0);
    for(let x=0;x<N;x++){let fx=(x+0.5)*sx-0.5,x0=Math.floor(fx);fx-=x0;const x1=Math.min(x0+1,w-1);x0=Math.max(x0,0);
      for(let c=0;c<3;c++){const v=(rgb[(y0*w+x0)*3+c]*(1-fx)+rgb[(y0*w+x1)*3+c]*fx)*(1-fy)+(rgb[(y1*w+x0)*3+c]*(1-fx)+rgb[(y1*w+x1)*3+c]*fx)*fy;
        out[(y*N+x)*3+c]=Math.round(v);}}}
  return out;};

// 가운데 32x32 -> H30 x S32 히스토그램, L2 정규화
const histogram=im=>{const N=64,px=resize(im,N),hist=new Float64Array(30*32);
  for(let y=16;y<48;y++)for(let x=16;x<48;x++){const i=(y*N+x)*3,r=px[i],g=px[i+1],b=px[i+2];
    const v=Math.max(r,g,b),mn=Math.min(r,g,b),diff=v-mn;
    const s=v?Math.round(255*diff/v):0;let hh=0;
    if(diff){hh=v===r?60*(g-b)/diff:v===g?120+60*(b-r)/diff:240+60*(r-g)/diff;if(hh<0)hh+=360;hh=Math.round(hh/2);if(hh>=180)hh-=180;}
    hist[Math.floor(hh*30/180)*32+Math.floor(s*32/256)]++;}
  let n=0;for(const v of hist)n+=v*v;n=Math.sqrt(n)||1;for(let i=0;i<hist.length;i++)hist[i]/=n;
  return hist;};

export const bhattacharyya=(a,b)=>{let s1=0,s2=0,s12=0;
  for(let i=0;i<a.length;i++){s1+=a[i];s2+=b[i];s12+=Math.sqrt(a[i]*b[i]);}
  return Math.sqrt(Math.max(1-s12/Math.sqrt(s1*s2),0));};

export const pngHist=buf=>histogram(decodePng(buf));
const dataUrlBuf=u=>Buffer.from(String(u).replace(/^data:[^,]*,/,''),'base64');
export const distance=(dataUrlA,dataUrlB)=>bhattacharyya(pngHist(dataUrlBuf(dataUrlA)),pngHist(dataUrlBuf(dataUrlB)));

// 요청 body로 d 계산. 거르기 대상 아니거나 실패하면 null.
export const prefilterDistance=body=>{try{
  const q=body?.questions;if(!q||!q.product_match||Object.keys(q).length!==1)return null;
  if(!Array.isArray(body.images)||body.images.length!==2)return null;
  const d=distance(body.images[0],body.images[1]);return Number.isFinite(d)?d:null;
}catch{return null;}};
