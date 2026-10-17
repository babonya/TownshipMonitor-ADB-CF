import {statSync} from 'node:fs';
import {resolve} from 'node:path';

// Compare bindings without rewriting their saved spelling or checksum input.
// Only case-only Windows aliases to the same existing directory are equivalent.
export function sameRootPath(left,right,platform=process.platform){
  if(typeof left!=='string'||!left||typeof right!=='string'||!right)return false;
  const a=resolve(left),b=resolve(right);
  if(a===b)return true;
  if(platform!=='win32'||a.toLowerCase()!==b.toLowerCase())return false;
  try{
    const first=statSync(a,{bigint:true}),second=statSync(b,{bigint:true});
    return first.isDirectory()&&second.isDirectory()&&first.dev>0n&&second.dev>0n&&first.ino>0n&&second.ino>0n&&
      first.dev===second.dev&&first.ino===second.ino;
  }catch{return false;}
}
