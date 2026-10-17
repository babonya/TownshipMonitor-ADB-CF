Township Monitor — Android ADB 배포본
작성일: 2026-10-11 (Asia/Seoul), r3 — 최신 설치 코드 및 간략 소개문 포함

간략한 기능·요구 환경 소개는 함께 있는 소개문.txt를 먼저 읽으세요.
이 파일을 환경 구축 AI에게 먼저 제공하세요. 명령은 Windows PowerShell 기준입니다.
<ADB_EXE>, <SERIAL>, 설치 경로는 새 PC에서 실제 확인한 값으로 바꾸세요.
배포본은 현재 설치된 Android ADB + SOM 프로그램의 스냅샷입니다.
실행 파일과 인식 원본/템플릿/소스가 포함됩니다. 외부 런타임과 AI 모델은 별도 설치합니다.
ZIP을 먼저 완전히 풀고, 쓰기 가능한 고정 경로(예: C:\TownshipMonitor-ADB)를 사용하세요.
ZIP 내부에서 실행하거나 다른 PC의 runtime/state.json, 가상환경, 장치 설정을 복사하지 마세요.

1. 지원 범위와 필수 화면 조건

- 호스트: Windows x64. 빌드 대상은 net8.0-windows / Windows Forms입니다.
  원본 운영 환경은 Windows 11 x64입니다. Linux/macOS용 실행 파일이 아닙니다.
- Android Township 패키지: com.playrix.township. 게임 언어는 English로 설정합니다.
- 프로그램이 받은 원본 ADB PNG가 정확히 가로 1544 × 세로 720이어야 합니다.
  주 디스플레이 displayId=0, Android rotation=90, 게임 영역은 전체 화면입니다.
  이 값은 PC 모니터 해상도나 Tango 브라우저 창 크기가 아닙니다.
  화면 배율로 1544×720처럼 보이게 만들거나 캡처를 리사이즈해 통과시키면 안 됩니다.
- 다른 해상도/회전/레터박스는 ANDROID_PROFILE_REQUIRED로 보류됩니다.
  임의 wm size/density 변경이나 프로필 숫자만 변경해 맞추지 말고 실제 게임 캡처로
  새 인식 프로필을 등록하고 검증해야 합니다. 이 ZIP에는 그런 기기의 지원 보장이 없습니다.
- 휴대폰 잠금을 해제하고 Township을 전면에 둡니다. 화면 꺼짐/잠금/회전을 방지합니다.
- 마을 화면의 배치와 카메라 위치도 등록 화면과 맞아야 합니다.
  현재 Android 프로필은 마을을 인식한 후 시장 (0.34, 0.49), 창고 (0.52, 0.30)를
  전체 게임 영역에 대한 비율로 사용합니다. 다른 마을 배치라면 그대로 실행하지 말고
  reference/som/android-1544/profile.json 및 원본 캡처를 확인하여 재등록합니다.
  헬리콥터·시장·창고 패널과 마을의 등록 원본은 reference/som/android-1544에 있습니다.
- 지원 실행 모드: android_adb + som, 헬리콥터 중심 배송/시장 구매/창고 회복.
  Android legacy, 다른 화면 크기, 기차·비행기 자동 배송은 이 배포본의 지원 범위가 아닙니다.
- APK, 게임 계정, 게임 데이터, Google/Android 로그인은 포함하지 않습니다.

2. 호스트 런타임 설치

현재 원본 환경에서 확인된 버전:
  Node.js: v24.14.1 x64 (node 명령이 PATH에서 실행되어야 함)
  Python: 3.12.5 x64 (3.12 계열 사용, 프로젝트 안에 venv를 새로 생성)
  .NET: Microsoft.WindowsDesktop.App 8.0.x x64
  ADB: Android Debug Bridge 1.0.41 / Platform Tools 37.0.0-14910828
  D1: LiquidAI/d1-3B-GGUF, Q8_0 + F16 vision projector
  llama.cpp: b11503, Windows x64 CUDA 12.4

.NET은 ASP.NET Runtime 또는 일반 .NET Runtime만으로 부족합니다.
반드시 .NET 8 Desktop Runtime x64를 설치하세요. 실행만 할 때 SDK는 필요 없습니다.
설치 후 터미널을 다시 열어 확인합니다:

  node --version
  py -3.12 --version
  dotnet --list-runtimes

출력에 Microsoft.WindowsDesktop.App 8.0.*가 있어야 합니다.
공식 설치 출처:
  Node.js: https://nodejs.org/en/download
  Python: https://www.python.org/downloads/windows/
  .NET 8 Desktop Runtime: https://dotnet.microsoft.com/en-us/download/dotnet/8.0
  Android Platform Tools: https://developer.android.com/tools/releases/platform-tools

3. Python 인식 환경

  Set-Location 'C:\TownshipMonitor-ADB'
  py -3.12 -m venv .venv-perception
  .\.venv-perception\Scripts\python.exe -m pip install -r .\tools\township-perception\requirements.lock.txt
  .\.venv-perception\Scripts\python.exe -m pip check
  .\.venv-perception\Scripts\python.exe -c "import cv2,numpy,rapidocr,onnxruntime; print('perception imports OK')"

패키지의 고정 버전은 requirements.lock.txt를 기준으로 합니다.
버전을 구할 수 없으면 실패 내용을 남기고 임의 최신 버전으로 바꿔 성공으로 처리하지 마세요.
다른 컴퓨터의 .venv-perception을 통째로 복사하면 Python 경로가 깨질 수 있습니다.
Monitor는 기본적으로 압축 해제 루트의 .venv-perception\Scripts\python.exe를 사용합니다.
TOWNSHIP_TEST_PYTHON 환경 변수가 있으면 이 경로를 덮어쓰므로 실제 의도한 Python인지 확인합니다.
RapidOCR은 수량/창고/무료 새로고침 시간 판독에 사용됩니다. 최초 초기화 시 OCR 모델의
인터넷 다운로드가 필요할 수 있습니다. 시작 전에 아래의 인식 점검까지 완료하세요.

4. SOM / D1-3B 로컬 서버

이 프로그램의 SOM은 로컬 이미지 비교 서비스입니다. Ollama나 ChatGPT API를 대신
연결하는 설정이 아닙니다. /v1/systemone API와 모델 식별자 d1-3b가 필요합니다.
게임 자동화 프로세스와 모델 서버는 별도 프로세스입니다.

재현 기준 GPU는 NVIDIA GeForce RTX 4070 SUPER입니다. CUDA 12.4 런타임을 실행할 수
있는 NVIDIA 드라이버가 필요합니다. GPU 최소 메모리를 보장하는 벤치마크는 없습니다.
원본과 같은 12GB VRAM급 환경을 재현 기준으로 삼고 /health 및 실제 이미지 추론을 확인합니다.
CPU 전용/AMD/Intel GPU는 이 CUDA 배포 절차로 검증하지 않았습니다.
모델+프로젝터는 합계 3,728,774,976바이트이며 런타임/컨텍스트/이미지 메모리는 추가입니다.
다운로드, 압축 해제, Python 패키지와 캡처 저장을 위해 충분한 디스크 여유를 확보하세요
(새 환경 설치용으로 10GB 이상 여유 권장; 장시간 캡처 보관은 별도).

설치 대상:
  %LOCALAPPDATA%\TownshipAI\d1-3b\
    models\d1-3B-Q8_0.gguf
    models\mmproj-d1-3B-F16.gguf
    runtime\llama-server.exe 및 CUDA/runtime DLL
    logs\
    Start-D1.ps1
    Stop-D1.ps1

고정 모델 revision: bb1e436ea78eb96a3f1acb6da865f70c2fbeb563
정확한 URL, 파일 크기, SHA-256은 deployment\d1-3b\install-manifest.json에 있습니다.
라이선스도 같은 폴더에 첨부되어 있습니다. 모델/런타임 바이너리는 ZIP에 넣지 않았습니다.
새 PC에서 다음 명령은 그 고정 파일들을 다운로드하고 크기와 SHA-256을 검증합니다:

  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\Install-D1.ps1

기존 설치 폴더가 있으면 설치 스크립트는 덮어쓰지 않고 중단합니다. 기존 서버의 상태,
파일과 해시를 먼저 확인하여 재사용하세요. 다운로드 실패 후의 부분 설치도 동일합니다.
재시도 시 전체 폴더를 무조건 삭제하지 말고 manifest와 대조하여 누락/실패 파일만 복구합니다.
두 ZIP(서버와 CUDA DLL)을 모두 runtime에 풀고 llama-server.exe가 바로 그 폴더에 있는지
확인하세요. 별도 CUDA Toolkit 개발 환경은 이 사전 빌드 실행의 필수 설치 항목이 아닙니다.

실행 및 상태 확인:

  & "$env:LOCALAPPDATA\TownshipAI\d1-3b\Start-D1.ps1"
  Invoke-RestMethod http://127.0.0.1:8087/health
  Invoke-RestMethod http://127.0.0.1:8087/v1/models

/health는 status=ok, /v1/models의 data에는 id=d1-3b가 있어야 합니다.
주소: http://127.0.0.1:8087/v1/systemone (localhost 전용, 외부 공개 불필요)
고정 시작 옵션: --alias d1-3b --gpu-layers 99 --ctx-size 4096
  --batch-size 2048 --ubatch-size 512 --parallel 1 --no-webui
Monitor는 정상 서버를 재사용하고, 없으면 위 설치 위치의 Start-D1.ps1을 호출합니다.
기본 Monitor의 endpoint는 8087입니다. 서버 포트만 바꾸면 연결되지 않습니다.
PowerShell 실행 정책으로 launcher가 거절되면 조직 정책을 유지하며 허용된 실행 방식으로
서버를 먼저 시작하고 위 두 상태 응답을 확인합니다. 시스템 전역 정책 변경은 필요 없습니다.
8087을 다른 서비스가 사용하면 임의 종료하지 말고 충돌 원인을 먼저 해결합니다.
종료: & "$env:LOCALAPPDATA\TownshipAI\d1-3b\Stop-D1.ps1"

5. Tango ADB와 휴대폰 연결

Tango 웹: https://app.tangoapp.dev/
USB 디버깅 안내: https://help.tangoapp.dev/prepare/
Tango는 초기 연결·미러링·수동 확인에 사용할 수 있습니다.
Monitor 자체는 Google ADB 실행 파일로 원본 PNG를 캡처하고 Android 터치를 전달합니다.
Tango가 항상 실행되어 있어야 하는 구조는 아닙니다.

1) Android 개발자 옵션에서 USB 디버깅을 켭니다. 데이터 전송 가능한 USB 케이블로 연결합니다.
2) 휴대폰의 이 PC RSA 디버깅 허용 창은 사용자가 확인합니다. Windows USB 드라이버가
   필요하면 기기 제조사의 공식 드라이버를 설치합니다.
3) Tango의 직접 Browser/WebUSB 연결은 Monitor 실행 전에 Disconnect하여 USB를 해제합니다.
   Tango Desktop/미러링을 병행하더라도 별도의 탭/프로세스에서 터치를 보내지 않습니다.
4) 공식 Platform Tools를 고정 경로에 풉니다. adb.exe와 AdbWinApi.dll,
   AdbWinUsbApi.dll 등 패키지 전체를 같은 폴더에 둡니다.
5) PowerShell에서 실제 경로와 serial을 확인합니다:

  $adb = 'C:\Android\platform-tools\adb.exe'
  & $adb version
  & $adb devices -l
  $serial = '<SERIAL>'
  & $adb -s $serial get-state

상태가 device여야 합니다. unauthorized는 휴대폰의 RSA 허용을 확인하고,
offline/목록 없음은 USB·드라이버·Tango 점유 상태를 해결합니다.
여러 기기가 보이면 사용할 serial을 명시하고 자동으로 첫 기기를 선택하지 않습니다.
무선 연결을 사용할 경우 adb connect 이후 표시된 실제 serial을 사용합니다.
재접속으로 serial이 바뀌면 아래 재바인딩 절차가 필요합니다.

6. 새 기기 캡처와 초기 세션 생성 (게임 입력 없음)

Township을 전면의 지원 화면으로 열어 둡니다. 아래 probe는 장치 정보를 읽고 원본
PNG를 저장하지만 터치를 보내지 않습니다. Windows PowerShell의 바이너리 리다이렉션으로
adb screencap 결과를 대신 저장하지 마세요. 제공된 CLI가 PNG 바이트를 보존합니다.

  New-Item -ItemType Directory -Path .\setup-local -Force | Out-Null
  node .\tools\android-adb-cli.mjs probe $adb $serial .\setup-local\device.json

setup-local\device.json 및 device.json.png를 확인합니다:
  provider=android_adb, packageName=com.playrix.township
  adbTarget.width=1544, height=720, rotation=90, displayId=0
  실제 PNG도 1544×720이고 Township 원본 화면이어야 합니다.
  adbExecutableHash, deviceSerial, bootId, physicalDisplayId는 현재 probe 값이어야 합니다.
예전 JSON이나 다른 휴대폰의 값으로 채우지 않습니다.

  node .\deployment\init-session.mjs .\setup-local\device.json
  node .\tools\mumu-monitor-cli.mjs .\runtime\mumu-autonomous-transport status

init-session은 새 runtime/mumu-autonomous-transport만 만들며 기존 세션을 덮어쓰지 않습니다.
workflowMode=som, helicopterOnly=true, 두 stop=true, managementAuthorized=false가 기본입니다.
임시 주문/재고/일일 배송 카운터나 이전 PC의 입력 권한을 가져오지 않습니다.
state.json은 checksum이 있는 프로그램 상태이므로 직접 JSON 편집하지 마세요.

7. 실행 전 인식 점검과 실행

게임 입력 없이 Android 원본/잘라내기 해시 검증 및 OCR 초기화를 점검합니다:

  .\.venv-perception\Scripts\python.exe -c "import sys; sys.path.insert(0,'tools/som'); from android_vision import AndroidVision; v=AndroidVision('reference/som/android-1544/profile.json'); v.get_ocr(); print('Android assets and OCR OK')"

추론 점검용으로 실제 주문/시장 상품 이미지 두 장을 준비한 뒤:

  .\.venv-perception\Scripts\python.exe "$env:LOCALAPPDATA\TownshipAI\d1-3b\Compare-Images.py" 'C:\path\order-item.png' 'C:\path\market-item.png'

answers.product_match.choice가 same_product / different_product / uncertain 중 하나로
반환되어야 합니다. 실제 서로 같은 상품/다른 상품 사례를 확인하세요.
일반 /v1/chat/completions 서비스가 응답하는 것만으로 D1 준비 완료가 아닙니다.

사용자가 이 기기의 자동 게임 조작을 요청한 경우에만 아래 관리 권한을 설정합니다.
환경 구축 요청만 받았다면 이 단계와 Start를 실행하지 않고 준비 상태를 보고하세요.
관리 권한을 켜면 프로그램은 현재 화면 판단에 따라 배송, 필요한 시장 구매,
정책에 해당하는 주문 삭제, 창고 가득 참 회복의 기본 수량 판매 등을 수행할 수 있습니다.
현금(TCash)·쿠폰·유료 가속·딜러 사용은 허용하지 않습니다.

  '{"op":"authorize_management","args":{"source":"explicit_user","scope":"transport_no_tcash"}}' | node .\tools\mumu-cli.mjs .\runtime\mumu-autonomous-transport request -

그다음 Start-ADB.cmd를 실행하고 Monitor의 Start를 누릅니다.
새 설치는 일시정지 상태라 창만 열었다고 자동 조작을 시작하지 않습니다.
기존 실행 중 세션은 재시작 시 자동 재개될 수 있으므로 중단하려면 Pause를 사용합니다.
Start-ADB.cmd는 현재 압축 해제 경로와 해당 runtime을 명시하여 실행합니다.
기본 UI의 옛 경로 기억이나 다른 설치의 바로가기를 사용하지 마세요.
동일 기기를 제어하는 Monitor를 여러 개 띄우지 않습니다.
미니게임 요청이 나오면 직접 해결한 후 '미니게임 해결' 버튼을 사용합니다.

8. 재부팅·기기 변경·ADB 업데이트·배포 폴더 이동

장치 bootId, serial, adb 실행 파일 경로/해시, 디스플레이 또는 회전이 바뀌면 기존
바인딩이 무효가 됩니다. Monitor Pause 완료, 프로세스 종료, 입력 정산 완료를 확인하고
새 probe를 만든 뒤 기존 세션의 현재 revision으로 bind합니다.

  node .\tools\android-adb-cli.mjs probe $adb $serial .\setup-local\device-new.json
  $status = node .\tools\mumu-cli.mjs .\runtime\mumu-autonomous-transport status | ConvertFrom-Json
  if (-not $status.ok) { throw 'Read session status before rebinding' }
  $revision = $status.result.revision
  $migration = 'device-' + [guid]::NewGuid().ToString()
  node .\tools\android-adb-cli.mjs bind .\runtime\mumu-autonomous-transport .\setup-local\device-new.json $revision $migration

bind는 stop과 기존 권한을 보존하고 과거 관측을 무효화합니다. 새 geometry도 1544×720,
rotation=90인지 확인해야 하며 bind가 다른 geometry를 지원 가능하게 바꾸지는 않습니다.
INPUT_UNRESOLVED, 활성 owner, revision 변경이 있으면 강제 덮어쓰지 않습니다.
Monitor의 정상 Restart와 보존된 증거로 해결하고 state.lock/device fence를 임의 삭제하지 않습니다.

9. 문제 진단

- ANDROID_PROFILE_REQUIRED: PNG 크기, displayId, rotation, SOM 모드를 확인합니다.
- ADB_*_CHANGED / TARGET 오류: foreground, 부팅/serial/ADB 해시/디스플레이 바인딩을 확인합니다.
- SOM_VISION_START_TIMEOUT / SOM_VISION_CLOSED: venv, pip check, import와 위 AndroidVision 초기화를 확인합니다.
- SOM_SERVER_MODEL_UNCONFIRMED: /v1/models에 d1-3b가 있는지 확인합니다.
- SOM_HTTP_* / SOM_RESPONSE_INVALID: 고정 llama.cpp 빌드의 /v1/systemone 응답을 확인합니다.
- GPU 로드 실패: logs의 stderr, 드라이버, VRAM 사용량, 두 CUDA archive 해시와 DLL을 확인합니다.
- SESSION_STOPPED: 새 설치의 의도한 기본값입니다. 조작 요청이 있을 때 Monitor Start로 시작합니다.
- MANAGEMENT_APPROVAL_REQUIRED: 환경 구축만으로 자동 조작 권한이 생기지 않습니다. 위 7절을 따릅니다.
- CURRENT/INPUT/OWNER hold: 현재 상태와 결과 증거를 확인합니다. 같은 클릭을 임의 반복하지 않습니다.
- 백신이 파일을 격리한 경우: manifest의 공식 출처와 SHA-256을 먼저 검증합니다.
  백신 전체 비활성화나 검증되지 않은 실행 파일로 교체하지 않습니다.

10. 배포 파일과 AI 작업 원칙

Start-ADB.cmd                 이동 가능한 Monitor 실행 진입점
artifacts/TownshipMonitor/    .NET Desktop Runtime을 사용하는 실행 파일
tools/                       원본 JavaScript/Python 실행 코드
reference/                   등록 이미지, 원본 캡처와 출처·해시·좌표 증거
deployment/init-session.mjs  새 기기 세션 초기화 (조작 없음)
deployment/Install-D1.ps1    고정 D1 다운로드 및 해시 검증 (서버 시작은 별도)
deployment/d1-3b/             D1 manifest, launcher, 이미지 비교 도구, 라이선스
deployment/package-manifest.json  배포 파일 크기와 SHA-256, 원본 execution release 식별자
AGENTS.md                    사용자 상품 관측·등록·퍼센티지 좌표·배송 지침
coordinate-contract.md       좌표 계약
docs/                        원본 동작 문서 및 과거 검증 기록

docs의 날짜별 설치 기록과 C:/Users/... 링크는 제작 PC의 역사적 증거입니다.
새 PC에 그 경로를 만들거나 과거 설치의 상태/권한을 복원하라는 지시가 아닙니다.
설치 경로와 환경 구성은 이 readme.txt와 현재 probe를 기준으로 합니다.
reference에는 Android SOM의 실제 사용 프로필과 템플릿/원본 증거,
프로그램 초기화에 필요한 공통 좌표·팝업 정책과 상품 목록 JSON을 포함합니다.
상품 카탈로그 이미지, 상품 upper-crops, PC/legacy의 미사용 인식 자료는 제외했습니다.
product-catalog.json은 변경하지 않은 공통 코드가 import 시 읽는 약 153KB의 상품 목록이며,
SOM 상품 이미지 판독에 카탈로그 그림을 사용한다는 뜻이 아닙니다.
현재 상품 판독은 주문/시장 화면에서 얻은 임시 상품 이미지를 D1으로 직접 비교합니다.
공유 WAIT/SPEED UP·미니게임·창고 경고의 현재 사용 이미지와 출처 원본은 유지합니다.
JavaScript/Python/C# 코드는 기존 파일을 그대로 유지했습니다. 남은 legacy 코드용
인식 자료를 제공하지 않으므로 이 배포본으로 PC/legacy 모드를 실행하지 마세요.
r3는 2026-10-11 현재 설치 코드의 스냅샷입니다. r2 이후 시장 4회 구매 후 복귀,
시장 위치 회복과 주문 새로고침·시장 복귀 재확인 개선을 반영했습니다.
출처 및 파일 해시는 deployment/package-manifest.json에 기록됩니다.

현재 게임 화면으로 주문과 보유량을 읽고 임시 필요 목록을 만듭니다.
재고·완료 주문 장부를 복구하거나 유지할 필요가 없습니다.
상품 등록은 실제 게임 원본 캡처를 바탕으로 하며 카탈로그 그림으로 대체하지 않습니다.
새 상품의 정체가 불명확하면 보류하고 AGENTS.md의 관측·등록·검증 절차를 수행합니다.
입력 좌표는 현재 화면에 연결된 0~1 비율이며 과거 픽셀 좌표를 재사용하지 않습니다.
헬리콥터 WAIT/SPEED UP은 새로고침 대기입니다. 초록 버튼을 배송으로 오인하지 않습니다.

배포 검증은 파일 의존성, 해시, 인식 초기화, 새 세션의 기본 정지 상태를 확인합니다.
새 PC의 드라이버/USB/GPU 설치와 실제 구매·배송 성공은 현장 점검이 필요합니다.
AI는 설치 완료 보고에 런타임 버전, probe PNG 크기/rotation, D1 health/model,
인식 초기화 결과, 세션 경로 및 paused/권한 상태를 함께 기록하세요.
