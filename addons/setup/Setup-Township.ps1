# 꿈의마을 자동 거래봇 처음설정 / 점검 스크립트 (Windows PowerShell 5.1)
#   처음설정.cmd  -> 이 스크립트 (안내에 따라 설치·입력)
#   점검.cmd      -> -CheckOnly (검사만, 아무것도 설치/저장하지 않음)
#   시작.cmd      -> -Quick     (핵심만 빠르게 검사, 종료 코드 = 필요 항목 수)
# 비밀값(Cloudflare ID/토큰, 텔레그램 토큰/chat id)은 파일에 쓰지 않고 Windows 사용자 환경변수에만 저장한다.
param([switch]$CheckOnly, [switch]$Quick)

if ($Quick) { $CheckOnly = $true }
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
$env:ANDROID_ADB_SERVER_PORT = '15037'
$Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$VenvPy = Join-Path $Root '.venv-perception\Scripts\python.exe'
$DeviceJson = Join-Path $Root 'setup-local\device.json'
$SessionRoot = Join-Path $Root 'runtime\mumu-autonomous-transport'
$StateJson = Join-Path $SessionRoot 'state.json'

$script:Results = New-Object System.Collections.ArrayList
$script:Serial = $null

# ---------- 출력 도우미 ----------
function Add-R([string]$Name, [string]$Status, [string]$Msg) {
  [void]$script:Results.Add([pscustomobject]@{ 항목 = $Name; 상태 = $Status; 내용 = $Msg })
  $color = 'Gray'
  if ($Status -eq '통과') { $color = 'Green' } elseif ($Status -eq '필요') { $color = 'Red' } elseif ($Status -eq '경고') { $color = 'Yellow' }
  Write-Host ("[{0}] {1}: {2}" -f $Status, $Name, $Msg) -ForegroundColor $color
}
function Info([string]$m) { Write-Host ("      " + $m) -ForegroundColor Cyan }
function Head([string]$m) { Write-Host ""; Write-Host ("=== " + $m + " ===") -ForegroundColor White }
function Ask-YN([string]$q) {
  if ($CheckOnly) { return $false }
  $a = Read-Host ($q + ' (Y/N)')
  return ($a -match '^\s*[Yy]')
}
function Mask([string]$v) {
  if (-not $v) { return '(없음)' }
  return ('{0}... (길이 {1})' -f $v.Substring(0, [Math]::Min(4, $v.Length)), $v.Length)
}
function Update-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($m + ';' + $u)
}
function Get-UserEnv([string]$n) {
  $v = [Environment]::GetEnvironmentVariable($n, 'User')
  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, 'Process') }
  if ($v) { Set-Item -Path ("env:" + $n) -Value $v }
  return $v
}
function Set-UserEnv([string]$n, [string]$v) {
  [Environment]::SetEnvironmentVariable($n, $v, 'User')
  Set-Item -Path ("env:" + $n) -Value $v
}
function ConvertFrom-Secure($s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Run-Native([string]$file, [string[]]$arguments) {
  $out = & $file @arguments 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $out }
}
function Has-Cmd([string]$n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }

function Install-Winget([string]$label, [string]$id) {
  if (-not (Has-Cmd 'winget')) {
    Info "winget이 없습니다. $label 을(를) 직접 내려받아 설치하세요 (Windows 10/11의 '앱 설치 관리자'를 업데이트하면 winget이 생깁니다)."
    return $false
  }
  Info "설치 명령: winget install -e --id $id"
  if (-not (Ask-YN "$label 을(를) 지금 설치할까요?")) { return $false }
  & winget install -e --id $id --accept-package-agreements --accept-source-agreements
  Update-Path
  return $true
}

# ---------- a. 런타임 ----------
function Check-Runtimes {
  Head 'a. 프로그램 설치 확인 (Node.js / Python / .NET / adb)'

  # Node 24
  $nv = $null
  if (Has-Cmd 'node') { $nv = (& node -v 2>$null) }
  if ($nv -match '^v24\.') { Add-R 'Node.js 24' '통과' $nv }
  else {
    Add-R 'Node.js 24' '필요' ($(if ($nv) { "현재 $nv (24.x 필요)" } else { '설치 안 됨' }))
    Info '내려받기: https://nodejs.org/ (24.x LTS 설치 파일). winget은 먼저 `winget show OpenJS.NodeJS` 로 24 버전이 있는지 확인하세요.'
    Info '설치 후 이 창을 닫고 처음설정.cmd를 다시 실행하세요.'
  }

  # Python 3.12
  $pv = $null
  if (Has-Cmd 'py') { $pv = (& py -3.12 -V 2>&1 | Out-String).Trim() }
  if ($pv -match '^Python 3\.12') { Add-R 'Python 3.12' '통과' $pv }
  else {
    if (-not $CheckOnly) {
      if (Install-Winget 'Python 3.12' 'Python.Python.3.12') {
        if (Has-Cmd 'py') { $pv = (& py -3.12 -V 2>&1 | Out-String).Trim() }
      }
    }
    if ($pv -match '^Python 3\.12') { Add-R 'Python 3.12' '통과' $pv }
    else {
      Add-R 'Python 3.12' '필요' 'Python 3.12 설치 필요 (py -3.12 가 동작해야 함)'
      Info '내려받기: https://www.python.org/downloads/ (3.12.x, 설치할 때 "py launcher" 포함). 또는 winget install -e --id Python.Python.3.12'
    }
  }

  # .NET 8 Desktop Runtime
  $dn = ''
  if (Has-Cmd 'dotnet') { $dn = (& dotnet --list-runtimes 2>$null | Out-String) }
  if ($dn -match 'Microsoft\.WindowsDesktop\.App 8\.') { Add-R '.NET 8 Desktop Runtime' '통과' 'Microsoft.WindowsDesktop.App 8.x' }
  else {
    $ok = $false
    if (-not $CheckOnly) {
      if (Install-Winget '.NET 8 Desktop Runtime' 'Microsoft.DotNet.DesktopRuntime.8') {
        if (Has-Cmd 'dotnet') { $dn = (& dotnet --list-runtimes 2>$null | Out-String) }
        $ok = ($dn -match 'Microsoft\.WindowsDesktop\.App 8\.')
      }
    }
    if ($ok) { Add-R '.NET 8 Desktop Runtime' '통과' '설치됨' }
    else {
      Add-R '.NET 8 Desktop Runtime' '필요' '설치 필요 (모니터 창 실행에 필요)'
      Info '내려받기: https://dotnet.microsoft.com/download/dotnet/8.0 -> ".NET Desktop Runtime 8" (x64)'
    }
  }

  # adb (platform-tools)
  if (Test-Path -LiteralPath $Adb) {
    $av = (& $Adb version 2>$null | Select-Object -First 1)
    Add-R 'adb (platform-tools)' '통과' ([string]$av)
  } else {
    $done = $false
    if (-not $CheckOnly) {
      Info "adb가 없습니다. 구글 공식 platform-tools를 받아 $($env:LOCALAPPDATA)\Android\Sdk\ 에 풉니다."
      Info '출처: https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
      if (Ask-YN 'platform-tools를 내려받아 설치할까요?') {
        try {
          $zip = Join-Path ([IO.Path]::GetTempPath()) 'platform-tools-latest-windows.zip'
          $dest = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
          New-Item -ItemType Directory -Path $dest -Force | Out-Null
          Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip -UseBasicParsing
          Expand-Archive -Path $zip -DestinationPath $dest -Force
          Remove-Item $zip -Force -ErrorAction SilentlyContinue
          $done = (Test-Path -LiteralPath $Adb)
        } catch { Info ("내려받기 실패: " + $_.Exception.Message) }
      }
    }
    if ($done) { Add-R 'adb (platform-tools)' '통과' '설치됨' }
    else {
      Add-R 'adb (platform-tools)' '필요' "없음: $Adb"
      Info '직접: 위 주소의 zip을 받아 압축을 풀면 platform-tools 폴더가 생깁니다. 그 폴더를 위 경로의 Sdk 아래에 두세요.'
    }
  }

  # 모니터 프로그램
  if (Test-Path -LiteralPath (Join-Path $Root 'artifacts\TownshipMonitor\TownshipMonitor.exe')) { Add-R '모니터 프로그램' '통과' 'artifacts\TownshipMonitor' }
  else { Add-R '모니터 프로그램' '필요' 'artifacts\TownshipMonitor\TownshipMonitor.exe 없음 (압축을 제대로 풀었는지 확인)' }
}

# ---------- b. venv ----------
function Check-Venv {
  Head 'b. 이미지 인식용 파이썬 환경 (.venv-perception)'
  $lock = Join-Path $Root 'tools\township-perception\requirements.lock.txt'
  if (-not (Test-Path -LiteralPath $VenvPy)) {
    $made = $false
    if (-not $CheckOnly -and (Has-Cmd 'py') -and ((& py -3.12 -V 2>&1 | Out-String) -match '3\.12')) {
      Info '.venv-perception 이 없습니다. 만들고 패키지를 설치합니다 (인터넷 필요, 몇 분 걸립니다).'
      if (Ask-YN '지금 만들까요?') {
        & py -3.12 -m venv (Join-Path $Root '.venv-perception')
        if (Test-Path -LiteralPath $VenvPy) {
          & $VenvPy -m pip install --progress-bar off -r $lock
          $made = $true
        }
      }
    }
    if (-not $made) {
      Add-R '파이썬 환경' '필요' '.venv-perception 없음 (Python 3.12 설치 후 처음설정.cmd)'
      return
    }
  }
  if ($Quick) { Add-R '파이썬 환경' '통과' '.venv-perception 있음 (빠른 검사)'; return }
  $r = Run-Native $VenvPy @('-m', 'pip', 'check')
  if ($r.Code -ne 0) {
    Add-R '파이썬 환경' '필요' ('pip check 실패: ' + ($r.Out.Trim() -replace '\s+', ' '))
    Info ('해결: ' + $VenvPy + ' -m pip install -r tools\township-perception\requirements.lock.txt')
    return
  }
  $r2 = Run-Native $VenvPy @('-c', 'import cv2,numpy,rapidocr,onnxruntime; print(1+1)')
  if ($r2.Code -eq 0) { Add-R '파이썬 환경' '통과' 'pip check 통과, cv2/numpy/rapidocr/onnxruntime 불러오기 성공' }
  else { Add-R '파이썬 환경' '필요' ('패키지 불러오기 실패: ' + ($r2.Out.Trim() -replace '\s+', ' ')) }
}

# ---------- c. Cloudflare ----------
function Test-CfToken([string]$id, [string]$tok) {
  $h = @{ Authorization = ('Bearer ' + $tok) }
  $last = '응답 없음'
  foreach ($u in @(('https://api.cloudflare.com/client/v4/accounts/' + $id + '/tokens/verify'), 'https://api.cloudflare.com/client/v4/user/tokens/verify')) {
    try {
      $r = Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 20
      if ($r.success -and $r.result.status -eq 'active') { return @{ Ok = $true; Msg = 'active' } }
      $last = 'status=' + $r.result.status
    } catch {
      $last = [string]$_.Exception.Message
    }
  }
  $last = $last.Replace($tok, '***').Replace($id, '***')
  return @{ Ok = $false; Msg = $last }
}

function Check-Cloudflare {
  Head 'c. Cloudflare AI (상품 비교용, 필수)'
  $id = Get-UserEnv 'CLOUDFLARE_ACCOUNT_ID'
  $tok = Get-UserEnv 'CLOUDFLARE_AUTH_TOKEN'

  if ((-not $id -or -not $tok) -and -not $CheckOnly) {
    Info 'Cloudflare 무료 계정이 필요합니다. 값은 이 PC의 사용자 환경변수에만 저장되고 파일에는 쓰이지 않습니다.'
    Info '1) https://dash.cloudflare.com 에 로그인(가입 무료).'
    Info '2) Account ID: 로그인 후 왼쪽 메뉴 Workers & Pages 화면 오른쪽의 "Account ID" (32자리 영문/숫자), 또는 주소창 dash.cloudflare.com/<여기가 Account ID>/ 부분.'
    Info '3) API 토큰: 오른쪽 위 프로필 -> My Profile -> API Tokens -> Create Token -> "Workers AI" 템플릿(Use template) -> Continue to summary -> Create Token.'
    Info '   권한은 Account / Workers AI / Read 와 Edit 이면 됩니다. 만든 직후 한 번만 보이는 토큰을 복사하세요.'
    Info '주의: 이 값을 남에게 보여주거나 화면 공유하지 마세요.'
    if ($id) { Info ('이미 저장된 Account ID를 사용: ' + (Mask $id)) }
    else {
      $in = (Read-Host 'Cloudflare Account ID 붙여넣기').Trim()
      if ($in -match '^[0-9a-fA-F]{32}$') { Set-UserEnv 'CLOUDFLARE_ACCOUNT_ID' $in; $id = $in }
      else { Info '형식이 맞지 않습니다 (32자리 영문/숫자). 다시 처음설정.cmd를 실행하세요.' }
    }
    if ($id -and -not $tok) {
      $sec = Read-Host 'API 토큰 붙여넣기 (화면에 보이지 않습니다)' -AsSecureString
      $plain = (ConvertFrom-Secure $sec).Trim()
      if ($plain.Length -ge 20) { Set-UserEnv 'CLOUDFLARE_AUTH_TOKEN' $plain; $tok = $plain }
      else { Info '토큰이 너무 짧습니다. 다시 처음설정.cmd를 실행하세요.' }
      $plain = $null
    }
  }

  if (-not $id -or -not $tok) {
    Add-R 'Cloudflare 키' '필요' '환경변수 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AUTH_TOKEN 없음 -> 처음설정.cmd 실행'
    return
  }
  if ($Quick) { Add-R 'Cloudflare 키' '통과' ('환경변수 있음 ID ' + (Mask $id) + ' / 토큰 ' + (Mask $tok)); return }

  $v = Test-CfToken $id $tok
  if (-not $v.Ok -and -not $CheckOnly) {
    Info ('토큰 확인 실패: ' + $v.Msg)
    if (Ask-YN '값을 다시 입력할까요?') {
      $in = (Read-Host 'Cloudflare Account ID 붙여넣기').Trim()
      $sec = Read-Host 'API 토큰 붙여넣기 (화면에 보이지 않습니다)' -AsSecureString
      $plain = (ConvertFrom-Secure $sec).Trim()
      if ($in -match '^[0-9a-fA-F]{32}$' -and $plain.Length -ge 20) {
        Set-UserEnv 'CLOUDFLARE_ACCOUNT_ID' $in; Set-UserEnv 'CLOUDFLARE_AUTH_TOKEN' $plain
        $id = $in; $tok = $plain; $v = Test-CfToken $id $tok
      } else { Info '입력 형식이 맞지 않아 저장하지 않았습니다.' }
      $plain = $null
    }
  }
  if ($v.Ok) {
    Add-R 'Cloudflare 키' '통과' ('토큰 active. ID ' + (Mask $id) + ' / 토큰 ' + (Mask $tok))
    Info '참고: 토큰에 Workers AI 권한이 있는지는 실제로 쓸 때 확인됩니다 (429면 하루 무료 한도, 401/403이면 권한 확인).'
  } else {
    Add-R 'Cloudflare 키' '필요' ('토큰 확인 실패: ' + $v.Msg + ' -> 토큰/Account ID를 다시 발급·입력 (처음설정.cmd)')
  }
}

# ---------- d. 텔레그램 (선택) ----------
function Tg-Call([string]$tok, [string]$method, $body) {
  $u = 'https://api.telegram.org/bot' + $tok + '/' + $method
  try {
    if ($body) {
      $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
      return Invoke-RestMethod -Uri $u -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 20
    }
    return Invoke-RestMethod -Uri $u -TimeoutSec 20
  } catch { return $null }
}

function Check-Telegram {
  Head 'd. 텔레그램 알림 (선택 - 건너뛰어도 됩니다)'
  $tok = Get-UserEnv 'TELEGRAM_BOT_TOKEN'
  $chat = Get-UserEnv 'TELEGRAM_CHAT_ID'
  $fresh = $false

  if ((-not $tok -or -not $chat) -and -not $CheckOnly) {
    Info '봇이 멈추거나 오류가 나면 폰 텔레그램으로 알려주는 기능입니다. 없어도 봇은 동작합니다.'
    if (Ask-YN '텔레그램 알림을 지금 설정할까요? (N이면 건너뜀)') {
      Info '1) 텔레그램에서 @BotFather 를 검색해 대화 시작 -> /newbot -> 이름과 아이디를 정하면 "토큰"을 줍니다.'
      Info '2) 방금 만든 내 봇을 검색해 들어가 "안녕" 같은 메시지를 아무거나 하나 보내세요.'
      if (-not $tok) {
        $sec = Read-Host '봇 토큰 붙여넣기 (화면에 보이지 않습니다)' -AsSecureString
        $tok = (ConvertFrom-Secure $sec).Trim()
      }
      $me = Tg-Call $tok 'getMe' $null
      if (-not ($me -and $me.ok)) { Info '토큰이 올바르지 않습니다. 저장하지 않았습니다.'; $tok = $null }
      else {
        Info ('봇 확인됨: @' + $me.result.username)
        [void](Read-Host '내 봇에게 메시지를 보냈으면 Enter')
        $up = Tg-Call $tok 'getUpdates' $null
        $found = $null
        if ($up -and $up.ok -and $up.result) {
          $msgs = @($up.result | Where-Object { $_.message -and $_.message.chat.type -eq 'private' })
          if ($msgs.Count -gt 0) { $found = $msgs[$msgs.Count - 1].message.chat }
        }
        if ($found) {
          $who = (($found.first_name + ' ' + $found.last_name).Trim())
          if (-not $who) { $who = [string]$found.username }
          if (Ask-YN ("메시지를 보낸 사람: '" + $who + "' (chat id " + $found.id + "). 이 대화로 알림을 받을까요?")) { $chat = [string]$found.id }
        } else {
          Info '메시지를 찾지 못했습니다. 봇에게 메시지를 보냈는지 확인하세요.'
          $c = (Read-Host 'chat id를 직접 알면 입력 (모르면 Enter)').Trim()
          if ($c -match '^-?\d+$') { $chat = $c }
        }
        if ($tok -and $chat) {
          Set-UserEnv 'TELEGRAM_BOT_TOKEN' $tok; Set-UserEnv 'TELEGRAM_CHAT_ID' $chat; $fresh = $true
        }
      }
    } else { Info '건너뜁니다. 나중에 처음설정.cmd를 다시 실행하면 설정할 수 있습니다.' }
  }

  if (-not $tok -or -not $chat) {
    Add-R '텔레그램 알림' '경고' '미설정 (선택 사항. 필요하면 처음설정.cmd)'
    return
  }
  $me = Tg-Call $tok 'getMe' $null
  if (-not ($me -and $me.ok)) {
    Add-R '텔레그램 알림' '경고' ('저장된 봇 토큰 ' + (Mask $tok) + ' 이(가) 확인되지 않음 (알림만 안 감, 봇 동작엔 영향 없음)')
    return
  }
  if ($CheckOnly) {
    Add-R '텔레그램 알림' '통과' ('봇 @' + $me.result.username + ' 확인됨, chat id 저장됨 (시험 전송은 처음설정에서)')
    return
  }
  $send = $fresh
  if (-not $fresh) { $send = (Ask-YN '시험 메시지를 보낼까요?') }
  if (-not $send) { Add-R '텔레그램 알림' '통과' ('봇 @' + $me.result.username + ' 확인됨'); return }
  $r = Tg-Call $tok 'sendMessage' @{ chat_id = $chat; text = '[꿈마] 설정 시험' }
  if ($r -and $r.ok) { Add-R '텔레그램 알림' '통과' '시험 메시지 전송됨 (폰에서 확인하세요)' }
  else { Add-R '텔레그램 알림' '경고' '시험 메시지 전송 실패 (chat id가 맞는지, 봇에게 먼저 메시지를 보냈는지 확인)' }
}

# ---------- e. 폰 ----------
function Get-AdbDevices {
  $list = @()
  $out = & $Adb devices 2>$null
  foreach ($l in $out) {
    if ($l -match '^(\S+)\s+(device|unauthorized|offline|authorizing|recovery|sideload|bootloader)\s*$') {
      $list += [pscustomobject]@{ Serial = $Matches[1]; State = $Matches[2]; Emu = ($Matches[1] -match '^emulator-' -or $Matches[1] -match '^127\.0\.0\.1:') }
    }
  }
  return $list
}

function Get-PngSize([string]$path) {
  try {
    $fs = [IO.File]::OpenRead($path)
    try { $b = New-Object byte[] 24; [void]$fs.Read($b, 0, 24) } finally { $fs.Dispose() }
    if ($b[0] -ne 137 -or $b[1] -ne 80 -or $b[2] -ne 78 -or $b[3] -ne 71) { return $null }
    $w = ($b[16] * 16777216) + ($b[17] * 65536) + ($b[18] * 256) + $b[19]
    $h = ($b[20] * 16777216) + ($b[21] * 65536) + ($b[22] * 256) + $b[23]
    return @{ W = [int]$w; H = [int]$h }
  } catch { return $null }
}

function Check-Phone {
  Head 'e. 안드로이드 폰 연결'
  if (-not (Test-Path -LiteralPath $Adb)) { Add-R '폰 연결' '필요' 'adb가 없어 확인 못 함 (a 단계 먼저)'; return }

  $saved = $null
  if (Test-Path -LiteralPath $DeviceJson) {
    try { $saved = (Get-Content -LiteralPath $DeviceJson -Raw | ConvertFrom-Json).serial } catch {}
  }

  $pick = $null
  while ($true) {
    $devs = @(Get-AdbDevices)
    $ready = @($devs | Where-Object { $_.State -eq 'device' -and -not $_.Emu })
    foreach ($d in $devs) {
      $tag = ''
      if ($d.Emu) { $tag = ' (에뮬레이터 - 선택 안 함)' }
      Info ('기기 목록: ' + $d.Serial + '  ' + $d.State + $tag)
    }
    $bad = @($devs | Where-Object { $_.State -ne 'device' -and -not $_.Emu })
    if ($ready.Count -gt 0) {
      if ($saved -and ($ready | Where-Object { $_.Serial -eq $saved })) { $pick = $saved }
      elseif ($ready.Count -eq 1) { $pick = $ready[0].Serial }
      elseif ($CheckOnly) { break }
      else {
        for ($i = 0; $i -lt $ready.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $ready[$i].Serial) }
        $n = Read-Host '사용할 폰 번호'
        if ($n -match '^\d+$' -and [int]$n -ge 1 -and [int]$n -le $ready.Count) { $pick = $ready[[int]$n - 1].Serial }
      }
      break
    }
    if ($CheckOnly) { break }
    if ($bad.Count -gt 0) { Info '폰 화면에 "USB 디버깅을 허용하시겠습니까?" 창이 뜨면 "이 컴퓨터에서 항상 허용" 체크 후 허용을 누르세요. (unauthorized/offline 상태)' }
    else { Info '연결된 폰이 없습니다. 폰 설정 -> 개발자 옵션 -> USB 디버깅 켜기, 데이터 전송 가능한 USB 케이블로 연결, 폰의 USB 모드는 "파일 전송".' }
    $a = Read-Host '해결했으면 Enter (건너뛰려면 Q)'
    if ($a -match '^[Qq]') { break }
  }

  if (-not $pick) {
    $devs = @(Get-AdbDevices)
    $ready = @($devs | Where-Object { $_.State -eq 'device' -and -not $_.Emu })
    if ($ready.Count -gt 1) { Add-R '폰 연결' '필요' ('폰이 여러 대입니다 (' + (($ready | ForEach-Object { $_.Serial }) -join ', ') + '). 처음설정.cmd에서 번호로 고르세요.') }
    elseif ($devs | Where-Object { $_.State -ne 'device' -and -not $_.Emu }) { Add-R '폰 연결' '필요' '폰이 보이지만 허용되지 않음(unauthorized/offline): 폰의 USB 디버깅 허용 창 확인, 케이블 재연결' }
    else {
      Add-R '폰 연결' '필요' 'USB로 연결된 폰이 없음: USB 디버깅 켜기, 데이터 전송 케이블, 폰 화면의 RSA 허용'
      Info ('adb는 고정 포트 15037 서버를 씁니다: ' + $Adb + ' devices')
    }
    return
  }
  $script:Serial = $pick
  Add-R '폰 연결' '통과' ('연결됨: ' + $pick)

  # 해상도
  $wm = (& $Adb -s $pick shell wm size 2>$null | Out-String)
  $size = $null
  if ($wm -match 'Override size:\s*(\d+)x(\d+)') { $size = @([int]$Matches[1], [int]$Matches[2]) }
  elseif ($wm -match 'Physical size:\s*(\d+)x(\d+)') { $size = @([int]$Matches[1], [int]$Matches[2]) }
  $okSize = $false
  if ($size) {
    $s = ($size | Sort-Object)
    $okSize = ($s[0] -eq 720 -and ($s[1] -eq 1600 -or $s[1] -eq 1544))
  }
  if ($okSize) { Add-R '폰 해상도' '통과' ('wm size ' + $size[0] + 'x' + $size[1] + ' (720 x 1600/1544 지원)') }
  else {
    $txt = '확인 못 함'
    if ($size) { $txt = [string]$size[0] + 'x' + [string]$size[1] }
    Add-R '폰 해상도' '필요' ('지원: 1600x720 또는 1544x720 가로. 지금 ' + $txt)
    Info '폰 설정 -> 디스플레이 -> 화면 해상도를 "HD+"(720x1600 계열)로 바꾸세요. 개발자 옵션의 "최소 너비"로 맞추지 마세요.'
  }

  # 실제 캡처 크기 / 회전
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('kk-cap-' + [guid]::NewGuid().ToString('N') + '.png')
  try {
    $cmdArgs = '/c ""' + $Adb + '" -s ' + $pick + ' exec-out screencap -p > "' + $tmp + '""'
    Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -Wait -NoNewWindow
    $ps = Get-PngSize $tmp
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  if (-not $ps) { Add-R '화면 캡처' '경고' '캡처를 읽지 못함 (폰 화면이 꺼져 있거나 잠겼을 수 있음)' }
  elseif (($ps.W -eq 1600 -or $ps.W -eq 1544) -and $ps.H -eq 720) { Add-R '화면 캡처' '통과' ('실제 캡처 ' + $ps.W + 'x' + $ps.H + ' (가로)') }
  elseif (($ps.H -eq 1600 -or $ps.H -eq 1544) -and $ps.W -eq 720) { Add-R '화면 캡처' '경고' ('세로 화면(' + $ps.W + 'x' + $ps.H + '). Township을 실행해 가로 화면으로 두세요') }
  else { Add-R '화면 캡처' '필요' ('지원하지 않는 크기 ' + $ps.W + 'x' + $ps.H + ' (1600x720 또는 1544x720 가로만 지원)') }

  # 게임 설치/실행
  $pk = (& $Adb -s $pick shell pm list packages --user 0 com.playrix.township 2>$null | Out-String)
  if ($pk -match 'package:com\.playrix\.township') {
    Add-R 'Township 설치' '통과' 'com.playrix.township'
    $fw = (& $Adb -s $pick shell dumpsys window 2>$null | Select-String 'mCurrentFocus' | Select-Object -First 1)
    if ($fw -and ([string]$fw) -notmatch 'com\.playrix\.township') { Info 'Township이 지금 화면에 떠 있지 않습니다. 처음설정(세션 만들기) 때는 게임을 실행해 가로 화면으로 두세요.' }
  } else {
    Add-R 'Township 설치' '필요' '폰에 Township(com.playrix.township)이 없음 - 플레이스토어에서 설치'
  }
  Info '게임 언어는 English로 해 두세요 (게임 설정 -> Language). 자동 확인은 못 합니다.'
}

# ---------- f. 세션 ----------
function Check-Session {
  Head 'f. 봇 세션 (probe / init-session / 권한)'
  if (-not $script:Serial) { Add-R '봇 세션' '필요' '폰이 확인되지 않아 점검 못 함'; return }
  $pick = $script:Serial
  $nodeOk = (Has-Cmd 'node')
  $origCli = Join-Path $Root 'tools\android-adb-cli.mjs'
  $myProbe = Join-Path $Root 'addons\setup\probe-device.mjs'

  # probe -> setup-local\device.json
  $devSerial = $null
  if (Test-Path -LiteralPath $DeviceJson) { try { $devSerial = (Get-Content -LiteralPath $DeviceJson -Raw | ConvertFrom-Json).serial } catch {} }
  $deviceOk = ($devSerial -eq $pick)
  if (-not $deviceOk -and -not $CheckOnly -and $nodeOk) {
    $why = 'device.json 이 없습니다.'
    if ($devSerial) { $why = "device.json 의 폰($devSerial)이 지금 폰($pick)과 다릅니다." }
    Info ($why + ' probe(폰 정보 읽기)를 실행합니다. 화면을 읽기만 하고 터치는 하지 않습니다.')
    Info '먼저 폰에서 Township을 실행해 가로 게임 화면이 전면에 떠 있게 하세요.'
    if ($devSerial -and (Test-Path -LiteralPath $StateJson)) {
      Info '이미 만든 세션이 있습니다. 폰을 바꾼 경우 세션을 새로 만들지 말고 readme.txt 8절(재바인딩)을 따르세요 - 여기서는 probe를 덮어쓰지 않습니다.'
    } elseif (Ask-YN 'probe를 실행할까요?') {
      New-Item -ItemType Directory -Path (Split-Path $DeviceJson) -Force | Out-Null
      if (Test-Path -LiteralPath $origCli) { $r = Run-Native 'node' @($origCli, 'probe', $Adb, $pick, $DeviceJson) }
      else { $r = Run-Native 'node' @($myProbe, $Adb, $pick, $DeviceJson) }
      if ($r.Code -ne 0) { Info ('probe 실패: ' + ($r.Out.Trim() -replace '\s+', ' ')) }
      if (Test-Path -LiteralPath $DeviceJson) { try { $devSerial = (Get-Content -LiteralPath $DeviceJson -Raw | ConvertFrom-Json).serial } catch {} }
      $deviceOk = ($devSerial -eq $pick)
    }
  }
  if ($deviceOk) {
    $dj = Get-Content -LiteralPath $DeviceJson -Raw | ConvertFrom-Json
    $t = $dj.adbTarget
    $geo = ('{0}x{1} rot {2}' -f $t.width, $t.height, $t.rotation)
    if (($t.width -eq 1600 -or $t.width -eq 1544) -and $t.height -eq 720 -and $t.rotation -eq 90) { Add-R '기기 정보(device.json)' '통과' ($geo + ', 시리얼 일치') }
    else { Add-R '기기 정보(device.json)' '필요' ($geo + ' - 지원은 1600x720/1544x720 rotation 90. 게임을 가로로 띄우고 device.json 삭제 후 처음설정.cmd') }
  } else {
    $m = 'setup-local\device.json 없음'
    if ($devSerial) { $m = "device.json 의 폰($devSerial)이 지금 폰($pick)과 다름" }
    Add-R '기기 정보(device.json)' '필요' ($m + ' -> 처음설정.cmd (게임을 가로로 띄운 상태)')
  }

  # init-session
  if (-not (Test-Path -LiteralPath $StateJson) -and -not $CheckOnly -and $deviceOk -and $nodeOk) {
    Info '봇 세션(runtime\mumu-autonomous-transport)이 없습니다. init-session으로 새로 만듭니다 (게임 입력 없음, 일시정지 상태로 시작).'
    if (Ask-YN '세션을 만들까요?') {
      $r = Run-Native 'node' @((Join-Path $Root 'deployment\init-session.mjs'), $DeviceJson)
      Info ($r.Out.Trim() -replace '\s+', ' ')
    }
  }
  if (Test-Path -LiteralPath $StateJson) {
    $st = Get-Content -LiteralPath $StateJson -Raw
    if ($st -match [regex]::Escape('"serial":"' + $pick + '"')) { Add-R '봇 세션' '통과' 'state.json 있음, 폰 시리얼 일치' }
    else { Add-R '봇 세션' '경고' 'state.json의 폰 시리얼이 지금 폰과 다름 (폰을 바꿨거나 재연결). readme.txt 8절(재바인딩) 참고' }
  } else {
    Add-R '봇 세션' '필요' 'runtime\mumu-autonomous-transport\state.json 없음 -> 처음설정.cmd'
    return
  }

  # 관리 권한
  if ($Quick -or -not $nodeOk) { return }
  $r = Run-Native 'node' @((Join-Path $Root 'tools\mumu-cli.mjs'), $SessionRoot, 'status')
  $authorized = ($r.Out -match '"scope":\s*"transport_no_tcash"')
  if (-not $authorized -and -not $CheckOnly) {
    Info '--- 자동 조작 권한 ---'
    Info '이 권한을 주면 프로그램이 현재 화면을 보고 배송, 필요한 시장 구매, 정책에 맞는 주문 삭제,'
    Info '창고 가득 참 시 기본 수량 판매 등을 스스로 합니다. 현금(TCash)·쿠폰·유료 가속·딜러 사용은 허용되지 않습니다.'
    Info '(원작자 readme.txt 7절의 정책과 같습니다. 권한을 안 주면 모니터는 켜지만 입력이 막힙니다.)'
    if (Ask-YN '자동 조작 권한을 줄까요?') {
      $json = '{"op":"authorize_management","args":{"source":"explicit_user","scope":"transport_no_tcash"}}'
      $out = $json | & node (Join-Path $Root 'tools\mumu-cli.mjs') $SessionRoot request - 2>&1 | Out-String
      Info ($out.Trim() -replace '\s+', ' ')
      $r = Run-Native 'node' @((Join-Path $Root 'tools\mumu-cli.mjs'), $SessionRoot, 'status')
      $authorized = ($r.Out -match '"scope":\s*"transport_no_tcash"')
    }
  }
  if ($authorized) { Add-R '자동 조작 권한' '통과' 'transport_no_tcash (현금·쿠폰·유료 가속 금지)' }
  else { Add-R '자동 조작 권한' '필요' '아직 안 줌 -> 처음설정.cmd (동의 시 부여)' }
}

# ---------- 실행 ----------
if ($CheckOnly) { Write-Host '[점검 모드] 설치·입력·저장 없이 검사만 합니다.' -ForegroundColor Cyan }
else { Write-Host '[처음설정] 단계마다 안내를 따라 주세요. 각 설치/입력 전에 Y/N으로 물어봅니다.' -ForegroundColor Cyan }

Check-Runtimes
Check-Venv
Check-Cloudflare
if (-not $Quick) { Check-Telegram }
Check-Phone
Check-Session

Head '요약'
foreach ($x in $script:Results) {
  $m = [string]$x.내용
  if ($m.Length -gt 70) { $m = $m.Substring(0, 70) + '...' }
  $c = 'Gray'
  if ($x.상태 -eq '통과') { $c = 'Green' } elseif ($x.상태 -eq '필요') { $c = 'Red' } elseif ($x.상태 -eq '경고') { $c = 'Yellow' }
  Write-Host ("[{0}] {1} - {2}" -f $x.상태, $x.항목, $m) -ForegroundColor $c
}
$need = @($script:Results | Where-Object { $_.상태 -eq '필요' }).Count
$warn = @($script:Results | Where-Object { $_.상태 -eq '경고' }).Count
if ($need -eq 0) {
  Write-Host ("모두 준비됐습니다 (경고 {0}건). 시작.cmd로 실행하세요." -f $warn) -ForegroundColor Green
} else {
  if ($CheckOnly) { Write-Host ("필요 {0}건, 경고 {1}건. 처음설정.cmd를 실행해 해결하세요." -f $need, $warn) -ForegroundColor Red }
  else { Write-Host ("필요 {0}건이 남았습니다. 안내대로 해결한 뒤 처음설정.cmd를 다시 실행하거나 점검.cmd로 확인하세요." -f $need) -ForegroundColor Red }
}
exit $need
