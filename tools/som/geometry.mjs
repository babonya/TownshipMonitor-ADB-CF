import {sha} from './client.mjs';
export const near=(a,b)=>a&&b&&Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)<24;
export const sameBox=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const descriptorDistance=(a,b)=>!a||!b||a.length!==b.length?Infinity:a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/a.length;
export const visionProof=v=>sha(v);
