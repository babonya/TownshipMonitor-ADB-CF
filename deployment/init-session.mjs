import {readFileSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MumuStore} from '../tools/mumu-store.mjs';
import {registeredAndroidGeometry} from '../tools/android-adb-observation.mjs';

// This bootstrap never captures, sends input, grants management or resumes play.
try {
  const [configPath, ...extra] = process.argv.slice(2);
  if (!configPath || extra.length) throw Error('Usage: node deployment/init-session.mjs DEVICE_JSON');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sessionRoot = join(root, 'runtime', 'mumu-autonomous-transport');
  if (existsSync(join(sessionRoot, 'state.json'))) throw Error('SESSION_ALREADY_EXISTS: preserve it; use documented probe/bind for rebinding');
  const config = JSON.parse(readFileSync(resolve(configPath), 'utf8').replace(/^\uFEFF/, ''));
  if (!registeredAndroidGeometry(config)) throw Error('ANDROID_PROFILE_REQUIRED: full 1544x720 or 1600x720 display, displayId 0, rotation 90');
  // Strip unexpected authorization and settings from the probe input.
  const {provider, executable, serial, packageName, adbExecutableHash, adbTarget} = config;
  const store = new MumuStore({root:sessionRoot});
  store.init({provider, executable, serial, packageName, adbExecutableHash, adbTarget,
    sessionId:'android-'+randomUUID(), recognitionMode:'on_demand'});
  store.transact(s => {
    s.settings.workflowMode='som'; s.settings.helicopterOnly=true;
    s.stopCapture=true; s.stopReader=true;
  });
  console.log(JSON.stringify({ok:true,sessionRoot,workflowMode:'som',paused:true,managementAuthorized:false,gameInputs:0}));
} catch(error) { console.error(error.message); process.exitCode=1; }
