// Cloudflare Workers AI(Clef) 중계기 — 봇 코드를 고치지 않고 로컬 d1-3b 서버 자리를 대신한다.
// 봇은 http://127.0.0.1:8087/v1/systemone 에 그대로 요청하고, 이 중계기가 Cloudflare로 넘긴다.
// 필요 환경변수: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AUTH_TOKEN (Workers AI 권한 토큰)
// 선택: CF_SOM_MODEL(clef-flash | clef, 기본 clef-flash), CF_SOM_PORT(기본 8087), CF_SOM_LOG(1이면 호출마다 로그)
//       CF_SOM_CONFIRM(기본 clef, off면 끔): product_match가 same_product일 때 이 모델로 재확인, 둘 다 same일 때만 same(아니면 uncertain)
//       — 2026-10-14 시험에서 clef-flash가 목화/옷감을 same으로 오판(잘못 구매 위험)한 대책
//       CF_SOM_PREFILTER(기본 0.75, off면 끔): product_match에서 두 이미지 색 분포 거리(0~1)가 이 값보다 크면 AI 호출 없이 different_product로 답함
// 실행: node addons\cf-som-proxy.mjs
//       CF_SOM_SAVE(기본 setup-local\som-pairs, off면 끔): product_match 요청 이미지와 답을 저장(정확도 측정·사전 거르기 기준용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prefilterDistance} from './som-prefilter.mjs';
import {SomCache} from './som-cache.mjs';

const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AUTH_TOKEN;
const model=process.env.CF_SOM_MODEL||'clef-flash',port=Number(process.env.CF_SOM_PORT||8087),log=process.env.CF_SOM_LOG==='1';
if(!account||!token){console.error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AUTH_TOKEN 환경변수가 필요합니다.');process.exit(1);}
const confirmModel=process.env.CF_SOM_CONFIRM||'clef';
// [2026-10-16] 오류는 창에만 찍혀 정지 원인(SOM_HTTP_502)을 나중에 알 수 없었다 → runtime/cf-som-proxy.log에도 남긴다.
const errorLog=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','runtime','cf-som-proxy.log');
const consoleError=console.error.bind(console);
console.error=(...a)=>{consoleError(...a);try{fs.appendFileSync(errorLog,new Date().toISOString()+' '+a.join(' ')+'\n');}catch{}};
const pfEnv=process.env.CF_SOM_PREFILTER,pfThreshold=pfEnv==='off'?null:(Number(pfEnv)||0.75);let skipped=0;
const url=m=>`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${m}`;
let calls=0,failures=0,confirms=0,vetoes=0,retries=0;
const saveDir=process.env.CF_SOM_SAVE==='off'?null:(process.env.CF_SOM_SAVE||fileURLToPath(new URL('../setup-local/som-pairs',import.meta.url)));
// [2026-10-16] 답 캐시(addons/som-cache.mjs, docs/SOM절감.md). CF_SOM_CACHE=off면 끔. 근접 캐시 답의 5%는 AI로 몰래 대조(그림자 검사).
const cache=process.env.CF_SOM_CACHE==='off'?null:new SomCache(saveDir);
const cacheLog=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','runtime','cf-som-cache.log');
let matchRequests=0;
const logCache=()=>{if(++matchRequests%100)return;try{fs.appendFileSync(cacheLog,`${new Date().toISOString()} requests ${matchRequests} ai ${calls} prefilter ${skipped} ${JSON.stringify(cache?.stats)}\n`);}catch{}};
// 쌍마다 폴더 하나: a.png, b.png(요청 순서 그대로), result.json. 같은 쌍은 한 번만 저장.
const savePair=(body,answers,ms,pfd=null)=>{try{
  if(!saveDir||!body.questions?.product_match||!Array.isArray(body.images))return;
  const id=crypto.createHash('sha256').update(body.images.join('|')).digest('hex').slice(0,16);
  const dir=path.join(saveDir,id);if(fs.existsSync(dir))return;fs.mkdirSync(dir,{recursive:true});
  body.images.forEach((u,i)=>fs.writeFileSync(path.join(dir,`${'ab'[i]??i}.png`),Buffer.from(String(u).replace(/^data:[^,]*,/,''),'base64')));
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({at:new Date().toISOString(),ms,model,confirmModel,answer:answers.product_match,prefilter:pfd},null,1));
}catch(error){console.error(`[cf-som] save ${error.message}`);}};
// 응답 봉투({result,success})가 있으면 벗긴다. 실패면 null.
const ask=async(m,body,ms)=>{const r=await fetch(url(m),{method:'POST',signal:AbortSignal.timeout(ms),
  headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,model:m})});
  const text=await r.text();calls++;let data;try{data=JSON.parse(text);}catch{data=null;}
  if(!r.ok||!data){failures++;console.error(`[cf-som] ${m} HTTP ${r.status} ${text.slice(0,500)}`);return null;}
  return data.result&&data.result.answers?data.result:data;};

const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const readBody=req=>new Promise((resolve,reject)=>{const chunks=[];let size=0;
  req.on('data',c=>{size+=c.length;if(size>13*1024*1024){reject(Error('BODY_TOO_LARGE'));req.destroy();}else chunks.push(c);});
  req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));req.on('error',reject);});

http.createServer(async(req,res)=>{
  try{
    // 봇의 ensureSomServer 점검(/health, /v1/models에 d1-3b) 통과용 — 실제 판정은 Cloudflare 모델이 한다.
    if(req.method==='GET'&&req.url==='/health')return send(res,200,{status:'ok'});
    if(req.method==='GET'&&req.url==='/v1/models')return send(res,200,{data:[{id:'d1-3b',backend:`cloudflare/${model}`}]});
    if(req.method!=='POST'||req.url!=='/v1/systemone')return send(res,404,{error:'not found'});
    const body=JSON.parse(await readBody(req));
    // 원작자 20261014판 client는 state:null을 보내는데 Cloudflare는 문자열이 아니면 거절(502) → 빈 문자열로.
    if(typeof body.state!=='string')body.state='';
    const started=Date.now();
    const pfd=pfThreshold===null?null:prefilterDistance(body);
    if(pfd!==null&&pfd>pfThreshold){skipped++;
      const payload={answers:{product_match:{type:'choice',choice:'different_product',probabilities:{same_product:0,different_product:1,uncertain:0},prefilter:pfd}}};
      // 사전 거르기로 생략한 쌍은 저장하지 않음(2026-10-14, 용량 — AI가 답한 쌍만 저장).
      if(log)console.log(`[cf-som] prefilter ${pfd.toFixed(3)} -> different_product`);
      return send(res,200,payload);}
    const onlyMatch=cache&&body.questions&&Object.keys(body.questions).length===1&&body.questions.product_match;
    if(onlyMatch){logCache();
      const hit=cache.lookup(body);
      if(hit){
        if(log)console.log(`[cf-som] cache ${hit.source} -> ${hit.answer.choice}`);
        send(res,200,{answers:{product_match:hit.answer}});
        // 그림자 검사: 근접 캐시 답의 5%는 AI에도 물어 다르면 기록(캐시 신뢰도 감시).
        if(hit.source==='near'&&Math.random()<0.05){cache.stats.shadow++;
          ask(model,body,4500).then(p=>{const c=p?.answers?.product_match?.choice;
            if(c&&c!==hit.answer.choice){cache.stats.shadowMismatch++;console.error(`[cf-som] cache mismatch ${hit.id} cache=${hit.answer.choice} ai=${c}`);}}).catch(()=>{});}
        return;}
    }
    // [2026-10-16] 봇은 5초만 기다린다. 4.5초 한 번에 걸면 Cloudflare가 한 번 느리거나 실패할 때 바로 502 → 봇 정지(정지사례 #8, 밤새 3회).
    // 평소 응답 0.5~0.7초라 첫 시도는 2.4초에서 끊고, 남은 시간 안에 한 번 더 시도한다.
    let payload=null;
    try{payload=await ask(model,body,2400);}catch(error){console.error(`[cf-som] first ${error.message}`);}
    if(!payload&&Date.now()-started<3800){retries++;payload=await ask(model,body,Math.max(500,4600-(Date.now()-started)));}
    if(!payload)return send(res,502,{error:'upstream'});
    const pm=payload.answers?.product_match;
    if(pm?.choice==='same_product'&&confirmModel!=='off'&&confirmModel!==model){
      confirms++;let c=null;
      try{c=(await ask(confirmModel,body,Math.max(500,4700-(Date.now()-started)))).answers?.product_match;}catch(error){console.error(`[cf-som] confirm ${error.message}`);}
      if(c?.choice!=='same_product'){vetoes++;payload.answers.product_match={...pm,choice:'uncertain',confirm:{model:confirmModel,choice:c?.choice??'failed',probabilities:c?.probabilities??null}};}
    }
    savePair(body,payload.answers,Date.now()-started,pfd);
    if(onlyMatch&&payload.answers?.product_match)cache.remember(body,payload.answers.product_match);
    if(log)console.log(`[cf-som] #${calls} ${Date.now()-started}ms ${JSON.stringify(payload.answers)}`);
    send(res,200,payload);
  }catch(error){failures++;console.error(`[cf-som] ${error.message}`);send(res,502,{error:error.message});}
}).listen(port,'127.0.0.1',()=>{console.log(`cf-som 중계기: http://127.0.0.1:${port}/v1/systemone -> ${model}, 재확인 ${confirmModel}`);
  // 저장 쌍 읽기는 시작(health 응답)을 막지 않게 listen 뒤에. 읽는 동안은 동일 쌍만 캐시, 나머지는 AI.
  if(cache){const t=Date.now();cache.load().then(()=>console.log(`[cf-som] cache ready ${cache.entries.length} pairs ${Date.now()-t}ms`));}});

process.on('SIGINT',()=>{console.log(`호출 ${calls}회, 사전거르기 ${skipped}회, 실패 ${failures}회, 재시도 ${retries}회, 재확인 ${confirms}회, 거부 ${vetoes}회`);process.exit(0);});
