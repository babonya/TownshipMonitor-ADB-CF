import {execFile} from 'node:child_process';
import {join} from 'node:path';

// Reusing an already healthy D1 service must not depend on launcher-file access.
// Only the configured loopback endpoint is probed; redirects are not followed.
export async function ensureSomServer({endpoint='http://127.0.0.1:8087/v1/systemone',fetchImpl=fetch,
  signal,localAppData=process.env.LOCALAPPDATA,execFileImpl=execFile,timeoutMs=5000}={}){
  if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/v1\/systemone$/.test(endpoint))throw Error('SOM_LOCAL_ENDPOINT_REQUIRED');
  const url=new URL(endpoint);
  const checkCancelled=()=>signal?.throwIfAborted();
  const ready=async()=>{
    checkCancelled();
    const timeout=AbortSignal.timeout(timeoutMs),probeSignal=signal?AbortSignal.any([signal,timeout]):timeout;
    try{
      const health=await fetchImpl(new URL('/health',url).href,{signal:probeSignal,redirect:'error'});
      if(!health.ok||(await health.json())?.status!=='ok')return false;
      const models=await fetchImpl(new URL('/v1/models',url).href,{signal:probeSignal,redirect:'error'});
      if(!models.ok)throw Error('SOM_SERVER_MODEL_UNCONFIRMED');
      const data=await models.json();
      if(!Array.isArray(data?.data)||!data.data.some(model=>model?.id==='d1-3b'))throw Error('SOM_SERVER_MODEL_UNCONFIRMED');
      checkCancelled();return true;
    }catch(error){
      checkCancelled();
      if(error.message==='SOM_SERVER_MODEL_UNCONFIRMED')throw error;
      return false;
    }
  };
  if(await ready())return;
  checkCancelled();
  if(!localAppData)throw Error('SOM_INSTALLATION_REQUIRED');
  let startError;
  try{
    await new Promise((resolve,reject)=>execFileImpl('powershell.exe',
      ['-NoProfile','-NonInteractive','-File',join(localAppData,'TownshipAI','d1-3b','Start-D1.ps1'),'-Port',url.port],
      {windowsHide:true,timeout:100000,signal},(error,_stdout,stderr)=>error?
        reject(Error(`SOM_SERVER_START_FAILED:${error.code??'unknown'}:${String(stderr||error.message).trim().slice(-2000)}`,{cause:error})):resolve()));
  }catch(error){startError=error;}
  checkCancelled();
  // A concurrent startup can succeed even if this launch attempt fails.
  // Conversely, a successful script exit alone is not server readiness.
  if(await ready())return;
  throw startError??Error('SOM_SERVER_NOT_READY');
}
