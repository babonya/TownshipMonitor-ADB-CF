# [사용자 변경 2026-10-15] 꿈의 마을 봇 감시(사용자 결정: "매크로를 켜면 무조건 계속 거래 진행").
# 봇은 결과를 모르는 입력(예: 시장 스크롤 adb 시간초과 PROCESS_TIMEOUT)이 생기면 원작자 설계대로 멈추고,
# '프로그램 재시작'(현재 화면부터 다시)만 그것을 정리한다. 이 감시는 그 재시작을 사람 대신 누른다.
# - 모니터가 일시정지가 아닌데(실행 중·정지 사유 표시 모두) 새 입력(adb-dispatch 마커)이 STALL_MINUTES 동안 없으면 정지로 본다.
# - 모니터가 '일시정지'이거나 꺼져 있으면 사람이 멈춘 것이므로 건드리지 않는다.
# - 폰 전면이 Township이 아니면(사람이 폰 사용 중) 재시작하지 않는다.
# - 재시작 간격 최소 MIN_GAP_MINUTES. 기록은 runtime\watchdog.log.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root 'runtime\mumu-autonomous-transport'
$Log = Join-Path $Root 'runtime\watchdog.log'
$AlertLog = Join-Path $Root 'runtime\alerts.log'
$HourlyLog = Join-Path $Root 'runtime\hourly.log'
$Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$Serial = $null   # [2026-10-17] 폰 시리얼은 환경변수 TOWNSHIP_SERIAL 또는 setup-local\device.json에서 읽는다(아래 Get-DeviceSerial)
$STALL_MINUTES = 6
$MIN_GAP_MINUTES = 10
$env:ANDROID_ADB_SERVER_PORT = '15037'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\TownshipBotWatchdog', [ref]$created)
if (-not $created) { exit 0 }

. (Join-Path $PSScriptRoot 'watchdog-alert.ps1')   # [2026-10-17] 알림·시간당 요약 로직
$script:LastShot = $null
function Write-Log($text) { Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding UTF8 }
function Get-DeviceSerial {
  if ($env:TOWNSHIP_SERIAL) { return $env:TOWNSHIP_SERIAL.Trim() }
  $f = Join-Path $Root 'setup-local\device.json'
  if (Test-Path $f) { try { $s = (Get-Content -Raw -Encoding UTF8 $f | ConvertFrom-Json).serial; if ($s) { return "$s".Trim() } } catch {} }
  return $null
}
while (-not ($Serial = Get-DeviceSerial)) { Write-Log '폰 시리얼 없음: 환경변수 TOWNSHIP_SERIAL 또는 setup-local\device.json(처음설정) 필요. 60초 뒤 재시도'; Start-Sleep 60 }
function Get-Root {
  $p = Get-Process TownshipMonitor -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return $null }
  [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}
function Get-Button($name) {
  $r = Get-Root; if (-not $r) { return $null }
  $c = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $r.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
}
function Invoke-Button($name) { (Get-Button $name).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
function Wait-Enabled($name, $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) { try { if ((Get-Button $name).Current.IsEnabled) { return $true } } catch {}; Start-Sleep 1 }
  return $false
}
function Get-Status {
  $r = Get-Root; if (-not $r) { return $null }
  $texts = $r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
    Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' } | ForEach-Object { $_.Current.Name }
  return ($texts | Select-Object -First 1)
}
function Test-TownshipForeground {
  # dumpsys가 'Broken pipe'를 stderr로 내면 Stop 설정에서 예외가 돼 재시작이 막혔다(10-16 06:17) → 이 함수에선 무시.
  $ErrorActionPreference = 'SilentlyContinue'
  $out = & $Adb -s $Serial shell 'dumpsys window | grep -m1 mCurrentFocus' 2>$null
  return ($out -match 'com\.playrix\.township')
}
function Get-LastInput {
  $dir = Join-Path $Source 'adb-dispatch'
  $f = Get-ChildItem $dir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { return $f.LastWriteTime } else { return (Get-Date) }
}
function Restart-Bot($why) {
  Write-Log "정지 감지: $why → 재시작"
  $script:LastShot = $null
  # [2026-10-16] 모르는 화면(SOM_SCREEN_UNIDENTIFIED)은 재시작으로 안 풀린다(정글 퀘스트·레벨업 배지 사례) → 원인 분석용으로 화면을 남긴다.
  # [2026-10-17] 모든 정지 감지에서 캡처한다. 모르는 화면은 기존 폴더, 그 외는 runtime\stall-shots(최근 50장만 유지).
  try {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if ($why -match 'SOM_SCREEN_UNIDENTIFIED') {
      $shot = Join-Path $Root ("setup-local\unknown-screens\auto-{0}.png" -f $stamp)
    } else {
      $shotDir = Join-Path $Root 'runtime\stall-shots'
      if (-not (Test-Path $shotDir)) { New-Item -ItemType Directory -Path $shotDir -Force | Out-Null }
      $shot = Join-Path $shotDir ("stall-{0}.png" -f $stamp)
    }
    cmd /c "`"$Adb`" -s $Serial exec-out screencap -p > `"$shot`"" 2>$null
    Write-Log "화면 캡처: $shot"
    $script:LastShot = $shot
    if ($shot -like '*stall-shots*') {
      Get-ChildItem (Split-Path $shot) -Filter 'stall-*.png' -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 50 | Remove-Item -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  try { & $Adb -s $Serial shell 'rm -f /data/local/tmp/township_endpoint_*.raw' 2>$null | Out-Null } catch {}
  if ((Get-Button '일시중지').Current.IsEnabled) { Invoke-Button '일시중지' }
  if (-not (Wait-Enabled '프로그램 재시작' 90)) { Write-Log '프로그램 재시작 버튼이 활성화되지 않음'; return }
  $old = (Get-Process TownshipMonitor | Select-Object -First 1).Id
  Invoke-Button '프로그램 재시작'
  for ($i = 0; $i -lt 60; $i++) {
    $p = Get-Process TownshipMonitor -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $old -and $_.MainWindowHandle -ne 0 }
    if ($p) { break }; Start-Sleep 1
  }
  if (-not (Wait-Enabled '시작' 120)) { Write-Log '시작 버튼이 활성화되지 않음'; return }
  Invoke-Button '시작'
  Start-Sleep 20
  Write-Log ("재시작 완료: " + (Get-Status))
}

Write-Log '감시 시작'
$lastRestart = (Get-Date).AddMinutes(-$MIN_GAP_MINUTES)
$AS = New-AlertState (Get-Date)
$isLoop = $false
$checkMinutes = 1
function Send-All($msgs) { foreach ($m in $msgs) { if ($m -is [hashtable]) { Send-Alert $m.Text $null $m.Photo } else { Send-Alert $m } } }
while ($true) {
  try {
    $status = Get-Status
    # [2026-10-17] 프로세스 소실 알림(다시 켜지 않음) — 중계기는 명령줄에 cf-som-proxy가 있는 node.
    try {
      $monitorUp = [bool](Get-Process TownshipMonitor -ErrorAction SilentlyContinue)
      # [2026-10-17] 사람이 멈춘 동안은 종료 알림 한 번 뒤로 프로세스 알림을 보내지 않는다.
      $wasStopped = $AS.ManualStopped
      Send-All (Test-ManualStop $AS $monitorUp $status)
      # [2026-10-18] 실행이 (다시) 시작되면 그때의 오늘 납품 수를 남긴다 → 텔레그램 /stat '이번 실행 이후 납품'(addons/telegram-bot.mjs).
      if ($AS.ManualStopped -eq $false -and $wasStopped -ne $false) {
        try {
          $dc0 = (& node (Join-Path $PSScriptRoot 'delivery-count.mjs') 2>$null | Select-Object -First 1)
          if ($dc0) { $d0, $t0 = ($dc0 -split ' '); [IO.File]::WriteAllText((Join-Path $Root 'runtime\run-start.json'), (@{ startedAt = (Get-Date).ToString('o'); date = $d0; total = [int]$t0 } | ConvertTo-Json -Compress)) }
        } catch { Write-Log ('실행 시작 기록 오류: ' + $_.Exception.Message) }
      }
      if (-not $AS.ManualStopped) {
        $relayUp = [bool](Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -like '*cf-som-proxy*' })
        Send-All (Test-Processes $AS $monitorUp $relayUp)
      }
    } catch { Write-Log ("프로세스 점검 오류: " + $_.Exception.Message) }
    # 오류로 모니터가 스스로 일시정지한 경우(예: '일시정지 · SOM_HTTP_502' — 중계기 502, 2026-10-16 00:00)도 정지로 본다.
    # 사람이 멈추려면 모니터를 닫거나, 이 사유가 없는 상태에서 일시중지한다.
    $autoPaused = Test-AutoPaused $status
    if ($status -and (-not $status.StartsWith('일시정지') -or $autoPaused)) {
      # 무입력 시간은 state.json 마지막 동작 시각으로 잰다(adb-dispatch 마커는 재시작 때 비워져 '방금 입력'으로 오판, 10-16 04:54).
      $check = (& node (Join-Path $PSScriptRoot 'loop-check.mjs') 2>$null | Select-Object -First 1)
      if (-not $check) { throw 'loop-check 실패' }
      $idle = [double]($check -split ' ')[-1]
      $isLoop = ($check -like 'LOOP*'); $checkMinutes = $idle
      Send-All (Test-Recovery $AS (Get-Date) $idle $isLoop $STALL_MINUTES)
      if ($idle -ge $STALL_MINUTES -and ((Get-Date) - $lastRestart).TotalMinutes -ge $MIN_GAP_MINUTES) {
        if (Test-TownshipForeground) { $why = ("{0:N0}분간 입력 없음, 상태='{1}'" -f $idle, $status); Restart-Bot $why; $lastRestart = Get-Date; Send-All (Register-Restart $AS (Get-Date) $why $status $script:LastShot) }
        else { Write-Log "입력 없음 $([int]$idle)분이지만 Township이 전면이 아님 - 재시작 안 함" ; $lastRestart = Get-Date }
      }
      # [2026-10-16] 헛돌기: 입력은 나가는데 같은 동작이 결과 없이 반복(정지사례 #9). 재시작으로 현재 화면부터 다시 판단하게 한다.
      elseif ($status.StartsWith('실행 중') -and ((Get-Date) - $lastRestart).TotalMinutes -ge $MIN_GAP_MINUTES) {
        $loop = $check
        if ($loop -like 'LOOP*') {
          if (Test-TownshipForeground) { $why = ("헛돌기 {0}" -f $loop); Restart-Bot $why; $lastRestart = Get-Date; Send-All (Register-Restart $AS (Get-Date) $why $status $script:LastShot) }
          else { Write-Log "헛돌기 $loop 이지만 Township이 전면이 아님 - 재시작 안 함"; $lastRestart = Get-Date }
        }
      }
    }
  } catch { Write-Log ("감시 오류: " + $_.Exception.Message) }
  # [2026-10-17] 시간당 요약(runtime\hourly.log) + 납품 0 알림
  try {
    if ((Get-Date) -ge $AS.NextHourly) {
      $dc = (& node (Join-Path $PSScriptRoot 'delivery-count.mjs') 2>$null | Select-Object -First 1)
      if (-not $dc) { throw 'delivery-count 실패' }
      $date, $total = ($dc -split ' ')
      $dj = (Get-Content (Join-Path $Source '.monitor\delivery.json') -Raw -Encoding UTF8 | ConvertFrom-Json).record.status
      $rep = Get-HourlyReport $AS (Get-Date) $date ([int]$total) $dj.phase $dj.reason $isLoop (Get-Status) ([bool](Get-Process TownshipMonitor -ErrorAction SilentlyContinue)) (-not $AS.RelayMissingAlerted)
      Add-Content -Path $HourlyLog -Value $rep.Line -Encoding UTF8
      if (-not $AS.ManualStopped) { Send-All $rep.Msgs }   # 사람이 멈춘 동안은 요약 줄만 남긴다
    }
  } catch { Write-Log ("시간당 요약 오류: " + $_.Exception.Message); $AS.NextHourly = (Get-Date).AddMinutes(5) }
  Start-Sleep 60
}
