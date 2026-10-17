TOWNSHIP MONITOR — ANDROID ADB DISTRIBUTION
Prepared: 2026-10-14 (Asia/Seoul)
Audience: another AI assistant and the person installing this application.

1. WHAT THIS PACKAGE IS

This is a snapshot of the installed Android ADB edition, with published Windows
executables, C# / JavaScript / Python source, and the installed recognition assets.
It is NOT the separate Google Play Games PC edition. Run it on a Windows x64 PC
connected to an Android phone running com.playrix.township.

Read USER_INSTRUCTIONS.txt first. It contains the workspace owner's instructions
and takes precedence over historical project documents. Then read AGENTS.md,
coordinate-contract.md, android-adb.md, adb-order-deletion.md and som-workflow.md.
The dated, newer Android sections supersede older legacy/Windows descriptions.
Historical absolute paths and links refer to the original developer's machine;
use the corresponding relative files in this package, never recreate that user's
directory tree or assume their saved authorization applies to a new operator.

Included: tools/, apps/, artifacts/TownshipMonitor/,
artifacts/TownshipDesktopBridge/, reference/, project documents, and D1 installation
support files in setup/d1-3b/. Source and installed binaries are copied as-is.
Excluded: live runtime/, Python virtual environment, .git, build caches, shortcuts,
personal device bindings, active orders, locks, execution logs, old investigation
folders, review-only failed-product archives, D1 model weights and D1 binaries.
Permanent failed-product registrations under reference/som ARE included because
the installed program reads them. This is an online-setup distribution, not a
self-contained offline installer. Dependencies must be installed separately.

2. HOW IT WORKS

TownshipMonitor.exe is a .NET 8 Windows Forms UI. It starts a Node.js JSON-lines
bridge (tools/mumu-monitor-cli.mjs --bridge). The bridge owns the capture/recognition
loop, workflow selection, pause/start handling and result reporting.

The Android adapter (tools/android-adb-device.mjs) inspects the selected device,
foreground app, boot ID, physical display, rotation and executable hash. It captures
the original PNG through ADB and issues guarded percentage-based touchscreen input.
Python/OpenCV/RapidOCR recognize registered screen regions and necessary text.
SOM uses a local D1 vision server for image/text decisions, including comparisons
between requested products and market products. No cloud AI key is required by
this local workflow.

The active Android workflow is SOM helicopter delivery: inspect current orders,
identify ready orders or missing product images, shop for eligible matching goods,
then recheck orders on the current screen. It also implements market-session rules,
refreshing-order navigation, supported popup handling, limited barn recovery and
minigame handoff. Do not describe this as general autonomous train/airplane support.

Important current behavior:
- Android registration is for 1544 x 720, rotation 90, full game display.
- English game labels and the registered town/layout are assumed. Other sizes,
  rotations, languages or town arrangements need real capture-based validation.
- A current requested slot of at least 8 units excludes the order from shopping;
  deletion also follows the common timer/target/input checks.
- WAIT / SPEED UP is not Send. Skip refreshing orders; when appropriate, return
  through town instead of buying acceleration.
- Market-session failure conditions and the verified 15-minute deletion gate are
  detailed in adb-order-deletion.md. This snapshot includes the 2026-10-14 changes.
- Temporary current observations are distinct from image-registration evidence.
  The installed Android code has a bounded market-session checkpoint; it is not
  an inventory ledger and must not be shipped from the original installation.
- Input completion is not proof of success. Current result evidence determines
  whether delivery/purchase/deletion succeeded. Never invent coordinates or clear
  unresolved-input safeguards to force progress.

3. REQUIRED ENVIRONMENT

Use Windows x64 with PowerShell and a writable extraction directory, for example
C:\TownshipMonitor-ADB. Avoid running directly inside the ZIP or Program Files.

a) Node.js: the source installation used v24.14.1. Use Node 24 x64, available on
PATH as node. The project uses built-in Node modules; there is no npm install step.
Official downloads: https://nodejs.org/en/download

b) .NET: install .NET 8 Windows Desktop Runtime x64 to run the supplied GUI and
bridge. The plain .NET runtime alone does not provide Windows Forms. To rebuild,
install the .NET 8 SDK as well.
Official downloads: https://dotnet.microsoft.com/en-us/download/dotnet/8.0

c) Python: source environment was Python 3.12.5 x64. Install Python 3.12 with the
Windows py launcher. Recreate the environment at the exact package-relative path:

  Set-Location 'C:\TownshipMonitor-ADB'
  py -3.12 -m venv .venv-perception
  .\.venv-perception\Scripts\python.exe -m pip install -r tools\township-perception\requirements.lock.txt
  .\.venv-perception\Scripts\python.exe -m pip check

The lock file preserves the installed dependency versions; do not silently relax
pins if a package is unavailable. requirements.txt lists direct dependencies.
Python downloads: https://www.python.org/downloads/windows/
RapidOCR may need its own model assets on first use; allow initial dependency/model
downloads and investigate a missing-model error rather than skipping OCR checks.

d) Android SDK Platform-Tools for Windows, including adb.exe and its companion DLLs.
Keep the entire platform-tools directory, for example C:\Android\platform-tools.
Official downloads: https://developer.android.com/tools/releases/platform-tools
Enable Developer options and USB debugging on the phone, connect a data-capable
cable and accept the phone's RSA authorization dialog. Install the phone vendor's
USB driver if Windows needs it. Close any browser/WebUSB application holding the
same USB device. Tango/browser control is not required.

  & 'C:\Android\platform-tools\adb.exe' devices -l

The intended device must have status device, not unauthorized/offline. Use the
exact serial from this command; never guess or copy the original operator's serial.
Open Township on the phone, keep it foreground, and use the registered landscape
orientation. Do not change display size merely to bypass a registration hold.

e) Local D1 server, installed as described next. The supplied launch configuration
uses NVIDIA CUDA 12.4 x64 binaries, with GPU offload for model and projector. It
requires a compatible NVIDIA GPU/driver and sufficient free GPU/system memory.
The weights alone total 3,728,774,976 bytes; inference needs additional memory.
No fixed minimum VRAM has been established by this packaging task. CPU-only or
other GPU runtimes require separate configuration and validation, not an assurance
that this launcher will work unchanged. Allow at least several GB of disk space
for models, downloaded archives, extracted runtime and Python packages.

4. INSTALL THE LOCAL D1 SERVER

setup/d1-3b contains the original launcher, stop script, comparison client, model
card, licenses and install-manifest.json. The manifest pins LiquidAI/d1-3B-GGUF
revision bb1e436ea78eb96a3f1acb6da865f70c2fbeb563 and llama.cpp release b11503,
with exact URLs, expected sizes and SHA-256 values. Review the included model and
runtime licenses. Model weights/runtime archives are deliberately not in this ZIP.

Run the following PowerShell from the extracted package root. This creates a NEW
D1 installation and refuses to overwrite an existing one. If D1 is already installed,
check that installation and its health instead of rerunning this block.

  $ErrorActionPreference = 'Stop'
  $d1Root = Join-Path $env:LOCALAPPDATA 'TownshipAI\d1-3b'
  if (Test-Path -LiteralPath $d1Root) { throw 'D1 already exists; inspect it first.' }
  Copy-Item -LiteralPath '.\setup\d1-3b' -Destination $d1Root -Recurse
  foreach ($name in @('models','downloads','runtime','logs')) {
    New-Item -ItemType Directory -Path (Join-Path $d1Root $name) -Force | Out-Null
  }
  $manifest = Get-Content -LiteralPath (Join-Path $d1Root 'install-manifest.json') -Raw | ConvertFrom-Json
  foreach ($entry in $manifest.files) {
    $target = Join-Path (Join-Path $d1Root $entry.directory) $entry.name
    Invoke-WebRequest -Uri $entry.url -OutFile $target -UseBasicParsing
    if ((Get-Item -LiteralPath $target).Length -ne $entry.size) { throw "Size mismatch: $target" }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
      throw "SHA-256 mismatch: $target"
    }
  }
  foreach ($entry in $manifest.files | Where-Object { $_.name -like '*.zip' }) {
    Expand-Archive -LiteralPath (Join-Path (Join-Path $d1Root $entry.directory) $entry.name) -DestinationPath (Join-Path $d1Root 'runtime') -Force
  }
  if (-not (Test-Path -LiteralPath (Join-Path $d1Root 'runtime\llama-server.exe'))) {
    throw 'Runtime archive layout differs; place llama-server.exe and its DLLs directly in runtime.'
  }
  & (Join-Path $d1Root 'Start-D1.ps1')
  Invoke-RestMethod 'http://127.0.0.1:8087/health'
  Invoke-RestMethod 'http://127.0.0.1:8087/v1/models'

Expected health: status ok. Model alias: d1-3b. The workflow endpoint is
http://127.0.0.1:8087/v1/systemone, not the ordinary chat/completions endpoint.
Keep port 8087 available. The Monitor can start this installed launcher on demand.
Do not point it at an unrelated server merely because that server has a health URL.
Use Stop-D1.ps1 or stop.cmd in the installed D1 folder to release its resources.
Download availability was not established by downloading the multi-GB payload again;
the installer must verify the pinned bytes using the supplied manifest.

5. CREATE A FRESH ANDROID SESSION (NO GAME INPUT)

There is no live runtime in this archive. The GUI expects an existing session.
Some historical documents mention tools/android-adb-cli.mjs, which is no longer
present in this installed snapshot. Do not use that obsolete command. The following
PowerShell block calls the current exported APIs and captures one verification PNG.
It does not click, swipe, purchase, send or authorize automation.

First adjust these two variables, then run the entire block from the package root:

  $env:TOWNSHIP_SETUP_ADB = 'C:\Android\platform-tools\adb.exe'
  $env:TOWNSHIP_SETUP_SERIAL = 'REPLACE_WITH_ADB_DEVICE_SERIAL'
  @'
  import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
  import {resolve,join} from 'node:path';
  import {createHash} from 'node:crypto';
  import {inspectAndroid,AndroidAdbDevice} from './tools/android-adb-device.mjs';
  import {MumuStore} from './tools/mumu-store.mjs';
  const root=resolve('runtime/mumu-autonomous-transport');
  if(existsSync(root)) throw Error('Session directory already exists; do not overwrite it.');
  const executable=resolve(process.env.TOWNSHIP_SETUP_ADB);
  const serial=process.env.TOWNSHIP_SETUP_SERIAL;
  const adbTarget=await inspectAndroid({executable,serial});
  if(adbTarget.width!==1544||adbTarget.height!==720||adbTarget.rotation!==90)
    throw Error('ANDROID_PROFILE_REQUIRED: register this actual layout before use.');
  const config={provider:'android_adb',executable,serial,packageName:'com.playrix.township',
    adbExecutableHash:createHash('sha256').update(readFileSync(executable)).digest('hex'),
    adbTarget,recognitionMode:'on_demand'};
  const packet=await new AndroidAdbDevice(config).capture();
  const store=new MumuStore({root});
  store.init(config);
  store.transact(s=>{s.stopCapture=true;s.stopReader=true;s.settings.workflowMode='som';});
  const evidence=resolve('setup/local-observation');
  mkdirSync(evidence,{recursive:true});
  writeFileSync(join(evidence,'first-frame.png'),packet.bytes);
  console.log(JSON.stringify({root,paused:true,mode:'som',gameInputs:0,
    dimensions:{width:packet.image.width,height:packet.image.height}}));
'@ | node --input-type=module
  if ($LASTEXITCODE -ne 0) { throw 'Session setup failed; inspect the error above.' }

Inspect setup/local-observation/first-frame.png. Matching dimensions alone do not
prove that the town placement, language, icons and UI agree with the registration.
If this phone/layout differs, have the AI inspect actual game captures and register
and validate the appropriate images/percentage geometry before starting deliveries.
Never resize an unrelated image and call it an original device registration.

6. AUTHORIZE AND RUN

Installation does not authorize gameplay. The fresh session is observation-only
and paused. After the receiving user has explicitly authorized transport automation
without T-cash, record that authorization using the existing command below. Do not
run it just because the original developer authorized a different installation.

  '{"op":"authorize_management","args":{"source":"explicit_user","scope":"transport_no_tcash"}}' | node tools/mumu-cli.mjs runtime/mumu-autonomous-transport request -

Then launch the packaged application from PowerShell:

  & '.\artifacts\TownshipMonitor\TownshipMonitor.exe' --root "$PWD" --source "$PWD\runtime\mumu-autonomous-transport"

Use the Monitor's connection/start controls (시작 to start, 일시정지 to pause).
The Android session must use SOM, not legacy. The supported path is helicopter work;
leave inventoryRoot unset. D1 and the Python worker must be healthy before work starts.
Pressing Start can perform purchases, delivery, deletion and the documented barn
sales under the accepted policy. Close/pause through the program so pending input
and ownership are settled. Do not force-kill processes or delete state/locks to
make an error disappear. Monitor settings are local to this extraction root under
%LOCALAPPDATA%\TownshipMonitor, and are not included in the ZIP.

One input owner only: do not run two automation sessions against the same phone.
After a phone reboot, rotation/resolution change or ADB executable update, old
bindings are intentionally invalid. Pause/close, inspect the actual current target,
and use tools/device-migration.mjs with current evidence at a settled boundary.
That API is for an existing session; do not overwrite state.json by hand. A genuinely
new installation may use a new empty extraction/session instead of migrating old
orders. Never abandon an unresolved physical input by starting a competing session.

7. TROUBLESHOOTING

- node not found: install Node x64, reopen PowerShell/Monitor, check node --version.
- Missing .NET framework: install Windows Desktop Runtime 8 x64, not only ASP.NET.
- Python launch/import errors: verify .venv-perception\Scripts\python.exe exists;
  run pip check and import cv2, numpy, rapidocr, onnxruntime. Do not copy a venv
  from the original user's PC; its interpreter paths are machine-specific.
- unauthorized/offline: inspect adb devices -l, cable, USB driver and phone dialog.
- ADB_TARGET_NOT_FOREGROUND: bring Township to the phone foreground.
- ANDROID_PROFILE_REQUIRED / ADB_GEOMETRY_CHANGED / target mismatch: inspect the
  current phone and its original capture. Do not suppress or weaken these checks.
- SOM_SERVER_START_FAILED / fetch failed: inspect D1 logs, the health/models URLs,
  port 8087, runtime/model files and GPU memory. A TCP listener alone proves nothing.
- MANAGEMENT_APPROVAL_REQUIRED: the new session lacks the explicit authorization
  described above. Creating a package or connecting a device is not that authority.
- INPUT_UNRESOLVED / FOREIGN_INPUT_OWNER: inspect canonical state and the actual
  current owner/result. Use documented guarded recovery; never repeat uncertain
  taps or clear locks blindly.
- Unrecognized product: follow USER_INSTRUCTIONS.txt. Use actual source captures,
  info-window evidence and crop/hash metadata. Do not register catalogue artwork
  as a substitute for game observations. Continue other supported orders when safe.
- Historical document links not found: follow the package-relative canonical file;
  old dated validation folders were intentionally not distributed.

8. SOURCE MAP, REBUILD AND VALIDATION

apps/TownshipMonitor/: native UI, controls, Node bridge client, presentation.
apps/TownshipDesktopBridge/: Windows native capture/input bridge. The Android path
uses ADB, but shared code still references this component; it is retained.
tools/mumu-monitor*.mjs: monitor controller, snapshot and worker coordination.
tools/android-adb-*.mjs, tools/android-market-drag.mjs: guarded Android transport.
tools/som/: SOM workflow, Python vision modules, local-model client, market and
helicopter decisions, temporary need images and failed-product handling.
tools/township-perception/: image matching, OCR and dependency pins.
reference/som/android-1544/: Android registrations and real source evidence.
reference/: other shared JSON/recognition assets required by the installed graph.
runtime/mumu-autonomous-transport/: created locally by setup; never shipped live.

To rebuild with the .NET 8 SDK, from the package root:

  powershell -NoProfile -File apps\TownshipMonitor\build.ps1
  powershell -NoProfile -File apps\TownshipDesktopBridge\build.ps1

To inspect status without starting a capture/delivery loop:

  node tools/mumu-monitor-cli.mjs runtime/mumu-autonomous-transport status

There is no complete test suite in the installed source snapshot. Archived tests
and acceptance reports cited by older documents are not promises about this ZIP.
For changes, follow AGENTS.md: validate representative positive/negative and
affected cases, and use an independent validator for behavior/recognition changes.

Packaging validation checks the copied payload, JS dependency imports, installed
reference bytes and permanent-product hashes, the fresh-session example with
simulated read-only ADB responses, and
ZIP integrity. It does not establish a clean-machine installation or a real-phone
purchase/delivery acceptance run. No live game input is needed to create this ZIP.

9. FIRST TASK FOR A RECEIVING AI

Identify the extracted root and read this file plus USER_INSTRUCTIONS.txt. Verify
dependencies and D1 health. Inspect the intended phone/registration match. Create
a fresh paused session only if none exists. Confirm the receiving user's authorized
scope before starting automation. Diagnose errors through the existing components;
do not add inventory ledgers, guessed coordinates, broad retry systems or automatic
authorization merely to get past a hold. Keep image provenance and current evidence.
