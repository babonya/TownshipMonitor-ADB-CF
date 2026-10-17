// [2026-10-16] product_match 답 캐시 — Cloudflare 무료 한도(하루 10,000 뉴런) 절감. 설계·근거: docs/SOM절감.md
// 1단계 동일 쌍: 이미지 바이트 해시가 같은 쌍은 저장된 답(som-pairs/<id>/result.json) 재사용.
// 2단계 근접 쌍: 필요 상품(a)·시장 칸(b) 서명이 모두 가까운 이전 쌍들의 답이 하나로 일치하면 재사용.
//   same은 엄격: 더 가까운 거리(SAME_DIST) 안에 same 기록이 2개 이상이고 다른 답이 하나도 없을 때만.
//   (저장된 same은 clef 재확인까지 통과한 답 — 중계기 confirm 단계)
// 서명 = 가운데 2/3 영역을 16×16 면적 평균(OpenCV INTER_AREA와 같은 방식), 거리 = 화소 평균 절대차.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {decodePng} from './som-prefilter.mjs';

export const DIFF_DIST=6,SAME_DIST=4,SAME_MIN=2,N=16;
export const defaultSeed=()=>process.env.CF_SOM_SEED!==undefined?process.env.CF_SOM_SEED:fileURLToPath(new URL('./som-seed/som-seed.bin.gz',import.meta.url));
export const pairId=images=>crypto.createHash('sha256').update(images.join('|')).digest('hex').slice(0,16);

export function signature(buf){
  const {w,h,rgb}=decodePng(buf);
  const x0=Math.floor(w/6),y0=Math.floor(h/6),cw=w-2*x0,ch=h-2*y0,out=new Float32Array(N*N*3),sx=cw/N,sy=ch/N;
  for(let oy=0;oy<N;oy++)for(let ox=0;ox<N;ox++){
    const fx0=ox*sx,fx1=fx0+sx,fy0=oy*sy,fy1=fy0+sy;let r=0,g=0,b=0,area=0;
    for(let y=Math.floor(fy0);y<Math.ceil(fy1);y++){const wy=Math.min(fy1,y+1)-Math.max(fy0,y);if(wy<=0)continue;
      for(let x=Math.floor(fx0);x<Math.ceil(fx1);x++){const wx=Math.min(fx1,x+1)-Math.max(fx0,x);if(wx<=0)continue;
        const k=((y0+y)*w+(x0+x))*3,a=wx*wy;r+=rgb[k]*a;g+=rgb[k+1]*a;b+=rgb[k+2]*a;area+=a;}}
    const o=(oy*N+ox)*3;out[o]=Math.round(r/area);out[o+1]=Math.round(g/area);out[o+2]=Math.round(b/area);}
  return out;
}
const dist=(p,q)=>{let s=0;for(let i=0;i<p.length;i++)s+=Math.abs(p[i]-q[i]);return s/p.length;};
const png=u=>Buffer.from(String(u).replace(/^data:[^,]*,/,''),'base64');

export class SomCache{
  constructor(dir,seedFile){this.dir=dir;this.byId=new Map();this.entries=[];this.ready=false;
    this.seedIds=new Set();this.seedFile=seedFile===undefined?defaultSeed():seedFile;
    this.stats={exact:0,near:0,nearSame:0,miss:0,shadow:0,shadowMismatch:0,seed:0};}
  // 시작을 막지 않도록 비동기로 저장 자료를 읽는다(읽는 동안은 AI로 처리).
  async load(){
    const ids=this.dir&&fs.existsSync(this.dir)?fs.readdirSync(this.dir):[];
    for(const id of ids){
      try{const d=path.join(this.dir,id),r=JSON.parse(fs.readFileSync(path.join(d,'result.json'),'utf8'));
        this.add(id,fs.readFileSync(path.join(d,'a.png')),fs.readFileSync(path.join(d,'b.png')),r.answer);}catch{}
      if(this.entries.length%200===0)await new Promise(r=>setImmediate(r));
    }
    try{this.loadSeed(new Set(ids));}catch(e){console.log('[cf-som] seed load failed: '+e.message);}
    this.ready=true;
  }
  // 씨앗(압축 서명 모음): 근접 판정용 entries에만 넣는다(byId=exact엔 넣지 않음). 디렉터리에 있는 id는 중복이라 건너뜀.
  loadSeed(dirIds){
    const f=this.seedFile;if(!f||!fs.existsSync(f))return;
    const raw=zlib.gunzipSync(fs.readFileSync(f));
    if(raw.length<12||raw.toString('latin1',0,8)!=='SOMSEED1')throw new Error('bad seed header');
    const n=raw.readUInt32LE(8),REC=8+2*N*N*3+1,CH=['same_product','different_product','uncertain'];
    if(raw.length!==12+n*REC)throw new Error('bad seed size');
    for(let i=0,o=12;i<n;i++,o+=REC){
      const id=raw.toString('hex',o,o+8),c=CH[raw[o+REC-1]];
      if(!c||this.byId.has(id)||dirIds.has(id)||this.seedIds.has(id))continue;
      this.seedIds.add(id);
      this.entries.push({a:Uint8Array.from(raw.subarray(o+8,o+8+N*N*3)),b:Uint8Array.from(raw.subarray(o+8+N*N*3,o+8+2*N*N*3)),choice:c});
      this.stats.seed++;
    }
  }
  add(id,a,b,answer){
    const choice=answer?.choice;if(!['same_product','different_product','uncertain'].includes(choice))return;
    if(this.byId.has(id))return;
    this.byId.set(id,answer);if(this.seedIds.has(id))return;   // 씨앗에 이미 있는 쌍은 근접 목록에 중복으로 넣지 않음
    this.entries.push({a:signature(a),b:signature(b),choice});
  }
  // 반환: {answer, source:'exact'|'near'} 또는 null(AI 필요)
  lookup(body){
    const images=body.images;if(!Array.isArray(images)||images.length!==2)return null;
    const id=pairId(images),hit=this.byId.get(id);
    if(hit){this.stats.exact++;return {answer:hit,source:'exact',id};}
    if(!this.ready)return null;
    let sa,sb;try{sa=signature(png(images[0]));sb=signature(png(images[1]));}catch{return null;}
    let diff=0,same=0,other=0;
    for(const e of this.entries){
      const da=dist(e.a,sa);if(da>=DIFF_DIST)continue;const db=dist(e.b,sb);if(db>=DIFF_DIST)continue;
      if(e.choice==='different_product')diff++;
      else if(e.choice==='same_product'&&da<SAME_DIST&&db<SAME_DIST)same++;
      else other++;   // uncertain, 또는 멀찍한 same → 판단 보류
    }
    if(diff>0&&same===0&&other===0){this.stats.near++;return {answer:cached('different_product',diff),source:'near',id};}
    if(same>=SAME_MIN&&diff===0&&other===0){this.stats.near++;this.stats.nearSame++;return {answer:cached('same_product',same),source:'near',id};}
    this.stats.miss++;return null;
  }
  remember(body,answer){try{const id=pairId(body.images);this.add(id,png(body.images[0]),png(body.images[1]),answer);}catch{}}
}
const cached=(choice,n)=>({type:'choice',choice,probabilities:{same_product:choice==='same_product'?1:0,different_product:choice==='different_product'?1:0,uncertain:0},cache:{matches:n}});
