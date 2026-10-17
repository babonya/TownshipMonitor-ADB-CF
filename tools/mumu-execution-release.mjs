import {javascriptDependencies,pythonDependencies,unboundRegistrationAssets} from './mumu-release-dependencies.mjs';
// Derive the executable dependency manifest, rather than maintaining a parallel
// list of implementation files. UI-only Monitor sources are outside this graph.
import {readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname,relative,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './adb.mjs';
import {fileIdentity,readStableFile} from './mumu-file-identity.mjs';
const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const releases=new Map();
const unchanged=record=>{
  try{
    for(const [path,identity]of record.files)if(fileIdentity(path)!==identity)return false;
    for(const [path,identity]of record.directories)if(fileIdentity(path,{directory:true})!==identity)return false;
    return true;
  }catch{return false;}
};
export function executionReleaseManifest(root=defaultRoot){
  root=resolve(root);const saved=releases.get(root);
  if(saved&&unchanged(saved))return structuredClone(saved.manifest);
  releases.delete(root);
  const entries=new Map(),files=new Map(),directories=new Map(),contents=new Map();
  const directory=path=>{if(!directories.has(path))directories.set(path,fileIdentity(path,{directory:true}));};
  const add=file=>{
    file=resolve(file);const path=relative(root,file).replaceAll('\\','/');
    if(path.startsWith('../')||path==='..'||!existsSync(file)||!statSync(file).isFile())throw Error('EXECUTION_DEPENDENCY_MISSING:'+path);
    if(entries.has(path))return;
    directory(dirname(file));
    const {bytes,identity}=readStableFile(file);files.set(file,identity);contents.set(file,bytes);entries.set(path,digest(bytes));
    if(extname(file)==='.mjs')for(const dependency of javascriptDependencies(file,bytes.toString('utf8')))add(dependency);
  };
  const walk=(dir,filter)=>{directory(dir);for(const e of readdirSync(dir,{withFileTypes:true})){if(['bin','obj','__pycache__','test-evidence'].includes(e.name))continue;
    const path=join(dir,e.name);if(e.isDirectory())walk(path,filter);else if(filter(e.name))add(path);
  }};
  for(const name of ['mumu-monitor-cli.mjs','mumu-cli.mjs','mumu-continuity-cli.mjs','mumu-inventory-cli.mjs'])add(join(root,'tools',name));
  // Python entrypoints import modules by name. Include the complete runtime
  // package (and dependency locks), excluding tests and authoring utilities.
  walk(join(root,'tools','township-perception'),name=>/^(worker|ocr_worker)\.py$/.test(name)||/^requirements.*\.txt$/.test(name));
  // Discover additional local Python dependencies transitively.
  for(const path of entries.keys())if(path.endsWith('.py')){
    const file=join(root,path),text=contents.get(file).toString('utf8');
    for(const dependency of pythonDependencies(file,text))if(existsSync(dependency))add(dependency);
  }
  walk(join(root,'apps','TownshipDesktopBridge'),name=>/\.(cs|csproj)$/.test(name));
  walk(join(root,'reference'),name=>name.endsWith('.json'));
  // Registrations bind their assets by hash and each recognizer verifies the
  // bytes before use. Include unbound registration assets in this manifest too.
  for(const path of entries.keys())if(path.startsWith('reference/')&&path.endsWith('.json')){
    const file=join(root,path),data=JSON.parse(contents.get(file).toString('utf8'));
    for(const asset of unboundRegistrationAssets(file,data))if(existsSync(asset))add(asset);
  }
  const manifest={schema:1,files:[...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)},record={files,directories,manifest};
  if(!unchanged(record))throw Error('EXECUTION_DEPENDENCIES_CHANGED_DURING_READ');
  if(releases.size>=4)releases.delete(releases.keys().next().value);
  releases.set(root,record);return structuredClone(manifest);
}
export const executionReleaseId=root=>digest(Buffer.from(JSON.stringify(executionReleaseManifest(root))));
