import { writeFileSync,unlinkSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runProcess } from './adb.mjs';
import { buildCandidates } from './perception.mjs';
import { MumuStore,sleep } from './mumu-store.mjs';

export function textRegions(width,height){
  const regions=[];
  for(let y=0;y<height;y+=400)for(let x=0;x<width;x+=600)regions.push({field:'tile-'+x+'-'+y,type:'text',box:{x,y,width:Math.min(600,width-x),height:Math.min(400,height-y)}});
  return regions;
}
export async function recognizeFile(store,frame,{language='ko-KR',runner=runProcess}={}) {
  if(!['ko-KR','en-US'].includes(language))throw Error('OCR_LANGUAGE_INVALID');
  const {file}=store.evidence(frame.id),regions=frame.ocrRegions??textRegions(frame.width,frame.height),config=join(store.root,'regions-'+randomUUID()+'.json');
  writeFileSync(config,JSON.stringify({regions}));
  try{
    const script=join(dirname(fileURLToPath(import.meta.url)),'ocr-file.ps1');
    const {stdout}=await runner('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',script,'-ImagePath',file,'-Language',language,
      '-RegionsPath',config,'-LogicalWidth',String(frame.width),'-LogicalHeight',String(frame.height)],{timeoutMs:60000,maxBytes:4*1024*1024});
    let report;try{report=JSON.parse(stdout.toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('OCR_RESULT_INVALID');}
    store.evidence(frame.id);
    return buildCandidates({...frame,confirmed:frame.review?.status==='accepted'?{quality:frame.review.quality}:null},report,regions);
  }finally{unlinkSync(config);}
}
export async function runRecognizer(store,{maxJobs=60,idleExitMs=5000,processor=recognizeFile,workerId='reader-'+randomUUID(),onResult=()=>{},producerAlive=()=>store.captureProducerAlive()}={}) {
  if(!Number.isSafeInteger(maxJobs) || maxJobs<1 || !Number.isSafeInteger(idleExitMs) || idleExitMs<100)throw Error('RECOGNIZER_OPTIONS_INVALID');
  let jobs=0,failed=0,lastWork=Date.now();
  while(jobs<maxJobs && !store.load().stopReader){
    const frame=await store.retry(()=>store.claim({workerId}),{attempts:1000});
    if(!frame){if(producerAlive())lastWork=Date.now();else if(Date.now()-lastWork>=idleExitMs)break;await sleep(100);continue;}
    const started=Date.now();let report=null,error=null;
    try{report=await processor(store,frame);}catch(e){error=e.message;failed++;}
    const result=await store.retry(()=>store.settle(frame.id,frame.job.token,{report,error}),{attempts:1000});jobs++;lastWork=Date.now();
    await onResult({frameId:frame.id,required:frame.required,status:result.job.status,observedAt:frame.observedAt,claimedAt:frame.job.claimedAt,completedAt:result.job.completedAt,
      queueWaitMs:Date.parse(frame.job.claimedAt)-Date.parse(frame.observedAt),elapsedMs:Date.now()-started,error,candidates:report?.candidates?.length??0});
  }
  return {jobs,failed};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [root,max='60',idle='5000',language='ko-KR',...extra]=process.argv.slice(2);if(!root || extra.length)throw Error('Usage: node tools/mumu-recognize.mjs ROOT [MAX_JOBS] [IDLE_EXIT_MS] [LANGUAGE]');
    const store=new MumuStore({root});const result=await runRecognizer(store,{maxJobs:Number(max),idleExitMs:Number(idle),processor:(s,f)=>recognizeFile(s,f,{language}),
      onResult:r=>process.stdout.write(JSON.stringify({kind:'recognition',...r})+'\n')});process.stdout.write(JSON.stringify({ok:true,result})+'\n');
  }catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');process.exitCode=1;}
}
