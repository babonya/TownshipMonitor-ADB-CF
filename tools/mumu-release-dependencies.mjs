import {resolve,dirname,join} from 'node:path';
export function* javascriptDependencies(file,text){
  for(const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+\.mjs)["']/g))yield resolve(dirname(file),m[1]);
  for(const m of text.matchAll(/new URL\(["'](\.[^"']+\.(?:ps1|py))["']/g))yield resolve(dirname(file),m[1]);
}
export function* pythonDependencies(file,text){
  for(const m of text.matchAll(/^[\t ]*(?:from|import)\s+([A-Za-z_][\w]*)/gm))yield join(dirname(file),m[1]+'.py');
}
export function unboundRegistrationAssets(file,data){
  const bound=new Set(),assets=[];
  const bindings=value=>{if(!value||typeof value!=='object')return;
    if(typeof value.file==='string'&&/^[a-f0-9]{64}$/.test(value.fileHash??value.hash??value.sha256??''))bound.add(value.file);
    for(const child of Object.values(value))bindings(child);
  };bindings(data);
  const scan=value=>{
    if(!value||typeof value!=='object')return;
    if(typeof value.file==='string'&&/\.(png|jpg|jpeg)$/i.test(value.file)&&!bound.has(value.file))assets.push(resolve(dirname(file),value.file));
    for(const child of Object.values(value))scan(child);
  };scan(data);return assets;
}
