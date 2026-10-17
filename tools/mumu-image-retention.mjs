import {existsSync,readdirSync,readFileSync,lstatSync,realpathSync,unlinkSync,rmdirSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

export const MAX_CAPTURE_IMAGES=100;
export const MAX_PRODUCT_EVIDENCE_IMAGES=100;
const defaultReferenceRoot=fileURLToPath(new URL('../reference',import.meta.url));
const registrations=new Map();
const key=path=>resolve(path).toLowerCase();
const plainDirectory=path=>{const s=lstatSync(path);return s.isDirectory()&&!s.isSymbolicLink()&&key(realpathSync(path))===key(path);};
const identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
function snapshot(path){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('NON_REGULAR_IMAGE');return {path,identity:identity(stat),time:stat.mtimeMs};}
function unchanged(file){return identity(lstatSync(file.path))===file.identity&&!lstatSync(file.path).isSymbolicLink();}

// Registrations are immutable within a running executable release. Preserve
// exact referenced originals, including older registrations outside reference/.
function registeredFiles(root){
  const cache=registrations.get(root);if(cache)return cache;
  const files=new Set();
  function scan(value,base){
    if(typeof value==='string'&&/\.(png|jpe?g|webp)$/i.test(value)){
      files.add(key(resolve(base,value)));
      // Existing evidenceRef/source records also use project-relative paths.
      files.add(key(resolve(dirname(root),value)));
    }
    else if(value&&typeof value==='object')for(const child of Object.values(value))scan(child,base);
  }
  function walk(dir){
    if(!plainDirectory(dir))throw Error('REGISTRATION_DIRECTORY_UNSAFE');
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const path=join(dir,entry.name);
      if(entry.isSymbolicLink())throw Error('REGISTRATION_LINK_UNSUPPORTED');
      if(entry.isDirectory())walk(path);
      else if(entry.name.endsWith('.json'))scan(JSON.parse(readFileSync(path,'utf8')),dir);
    }
  }
  if(existsSync(root))walk(root);registrations.set(root,files);return files;
}
const recent=(a,b)=>b.time-a.time||b.path.localeCompare(a.path);

// Called only after state commit, under the existing state lock. Retained state
// includes transitive current/input/worker proofs; temporary needs live outside it.
export function pruneCaptureImages(root,state,{referenceRoot=defaultReferenceRoot}={}){
  const result={limit:MAX_CAPTURE_IMAGES,removed:0,remaining:0,protected:0,overflow:false,errors:[]};
  try{
    if(!(state.session?.provider==='google_play_windows'||state.session?.provider==='android_adb'&&state.settings?.workflowMode==='som'))return {...result,skipped:'LEGACY_HISTORY_REQUIRED'};
    const dir=join(resolve(root),'frames');if(!existsSync(dir))return result;
    if(!plainDirectory(dir))throw Error('CAPTURE_DIRECTORY_UNSAFE');
    const registered=registeredFiles(referenceRoot),keep=new Set(Object.keys(state.frames??{}).map(id=>key(join(dir,id+'.png'))));
    const needsFile=join(root,'.monitor','som-needs','current.json');
    if(existsSync(needsFile))for(const entry of JSON.parse(readFileSync(needsFile,'utf8')).images??[]){
      const id=entry.source?.frameId;if(typeof id==='string'&&/^frame-[a-f0-9-]+$/.test(id))keep.add(key(join(dir,id+'.png')));
    }
    const files=readdirSync(dir).filter(n=>/^frame-[a-f0-9-]+\.png$/.test(n)).map(n=>snapshot(join(dir,n))).sort(recent);
    // Registered originals are permanent assets, not ordinary capture history.
    const ordinary=files.filter(f=>!registered.has(key(f.path)));
    result.registeredOriginals=files.length-ordinary.length;
    result.protected=ordinary.filter(f=>keep.has(key(f.path))).length;
    let slots=Math.max(0,MAX_CAPTURE_IMAGES-result.protected);
    for(const file of ordinary){
      if(keep.has(key(file.path)))continue;
      if(slots-->0)continue;
      try{if(!unchanged(file))throw Error('IMAGE_CHANGED');unlinkSync(file.path);result.removed++;}
      catch(error){result.errors.push({path:file.path,reason:error.message});}
    }
    result.remaining=ordinary.length-result.removed;result.overflow=result.remaining>MAX_CAPTURE_IMAGES;
  }catch(error){result.errors.push({reason:error.message});}
  return result;
}

// Tooltip and observation bundles share one 100-image budget. Prune complete
// bundles, never separate a crop from its source or item-name evidence.
export function pruneProductEvidenceImages(root,{protectedDirectories=[],referenceRoot=defaultReferenceRoot}={}){
  const result={limit:MAX_PRODUCT_EVIDENCE_IMAGES,removed:0,removedBundles:0,remaining:0,protected:0,overflow:false,errors:[]};
  try{
    root=resolve(root);if(!existsSync(root))return result;
    if(!plainDirectory(root))throw Error('PRODUCT_EVIDENCE_DIRECTORY_UNSAFE');
    const registered=registeredFiles(referenceRoot),active=new Set(protectedDirectories.map(key)),bundles=[];
    const parents=[root];if(existsSync(join(root,'observations')))parents.push(join(root,'observations'));
    for(const parent of parents){
      if(!plainDirectory(parent))throw Error('PRODUCT_EVIDENCE_DIRECTORY_UNSAFE');
      for(const entry of readdirSync(parent,{withFileTypes:true})){
        if(!entry.isDirectory()||entry.name==='observations')continue;
        const dir=join(parent,entry.name),meta=join(dir,'metadata.json');
        if(!plainDirectory(dir)||!existsSync(meta))continue;
        const metadata=snapshot(meta),m=JSON.parse(readFileSync(meta,'utf8'));
        const tooltip=m.schema===1&&typeof m.evidenceKey==='string'&&m.files;
        const observation=m.schema===1&&m.purpose==='product_registration_evidence'&&Array.isArray(m.items);
        if(!tooltip&&!observation)continue;
        const names=readdirSync(dir),images=names.filter(n=>/\.png$/i.test(n));
        if(names.some(n=>n!=='metadata.json'&&!images.includes(n)))continue;
        const expected=new Set(tooltip?Object.keys(m.files):['source.png',...m.items.map(i=>i.file)]);
        if(images.some(n=>basename(n)!==n||!expected.has(n)))continue;
        const files=images.map(n=>snapshot(join(dir,n)));
        const registeredBundle=files.some(f=>registered.has(key(f.path)))||!!m.registration||
          ['registered','applied','validated'].includes(m.registrationStatus)||
          (m.items??[]).some(i=>!!i.registration||['registered','applied','validated'].includes(i.registrationStatus));
        if(registeredBundle)continue;
        const protectedBundle=active.has(key(dir))||!['complete','failed'].includes(m.status)&&!['unreadable','rejected'].includes(m.registrationStatus);
        bundles.push({path:dir,metadata,files,protected:protectedBundle,time:Date.parse(m.createdAt??m.source?.observedAt) || metadata.time});
      }
    }
    bundles.sort(recent);result.protected=bundles.filter(b=>b.protected).reduce((n,b)=>n+b.files.length,0);
    let slots=Math.max(0,MAX_PRODUCT_EVIDENCE_IMAGES-result.protected);
    for(const bundle of bundles){
      result.remaining+=bundle.files.length;
      if(bundle.protected)continue;
      if(bundle.files.length<=slots){slots-=bundle.files.length;continue;}
      try{
        if(!unchanged(bundle.metadata)||bundle.files.some(f=>!unchanged(f)))throw Error('EVIDENCE_CHANGED');
        // Known files only; no recursive removal and no linked directories.
        if(!plainDirectory(bundle.path))throw Error('PRODUCT_EVIDENCE_DIRECTORY_UNSAFE');
        for(const file of bundle.files){unlinkSync(file.path);result.removed++;result.remaining--;}
        unlinkSync(bundle.metadata.path);rmdirSync(bundle.path);result.removedBundles++;
      }catch(error){result.errors.push({path:bundle.path,reason:error.message});}
    }
    result.overflow=result.remaining>MAX_PRODUCT_EVIDENCE_IMAGES;
  }catch(error){result.errors.push({reason:error.message});}
  return result;
}
