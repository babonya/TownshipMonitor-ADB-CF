// File-change fences for process-local caches. Never persist these identities
// as evidence or use age/mtime alone. Replacements and restored mtime retain a
// different inode or change time; every changed identity requires fresh bytes.
import {statSync,readFileSync} from 'node:fs';
export function fileIdentity(path,{directory=false}={}){
  const s=statSync(path,{bigint:true});
  if(directory?!s.isDirectory():!s.isFile())throw Error('CACHE_FILE_TYPE_CHANGED');
  return [s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs,s.birthtimeNs].join(':');
}
export function readStableFile(path){
  const identity=fileIdentity(path),bytes=readFileSync(path);
  if(identity!==fileIdentity(path))throw Error('CACHE_FILE_CHANGED_DURING_READ');
  return {identity,bytes};
}
