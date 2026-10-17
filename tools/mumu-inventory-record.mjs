import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {sameRootPath} from './mumu-path-identity.mjs';
import {findInventoryOperation} from './mumu-inventory-journal.mjs';
const VERSION='township-inventory-1';
const fail=code=>{throw Error(code);};
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
const integer=x=>Number.isSafeInteger(x)&&x>=0;
export function readInventoryRecord(root,sourceRoot,state){
  const file=join(root,'inventory.json');
    if(!existsSync(file))fail('INVENTORY_NOT_INITIALIZED');
    const envelope=JSON.parse(readFileSync(file,'utf8'));
    if(envelope.version!==VERSION||sha(envelope.record)!==envelope.checksum)fail('INVENTORY_INTEGRITY_ERROR');
    const record=envelope.record;
    if(!sameRootPath(record.sourceRoot,sourceRoot)||record.sourceSessionId!==state.session.id)fail('INVENTORY_SOURCE_MISMATCH');
    if(!integer(record.revision)||!Array.isArray(record.operations)||!Array.isArray(record.effects)||!Array.isArray(record.orderFrameIds)||record.executionAllowed!==false)fail('INVENTORY_RECORD_INVALID');
    if(record.operationsArchive!==undefined)findInventoryOperation(root,record,null);
    return record;
}
