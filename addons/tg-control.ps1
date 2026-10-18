# [사용자 변경 2026-10-18] 텔레그램 /start /stop 로 꿈마 모니터 제어(telegram-bot.mjs가 호출). 결과 한 줄을 stdout으로.
# start   = 모니터 '시작'(꺼진 게임 자동 실행 → 창고부터). 모니터가 없으면 Start-TownshipCF.cmd로 띄운 뒤 '시작'.
# stop    = 모니터 '일시중지'(창은 유지) + 폰 Township 강제 종료. 일시중지 상태는 감시가 건드리지 않는다.
param([Parameter(Mandatory)][ValidateSet('start','stop','status')][string]$Action)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$env:ANDROID_ADB_SERVER_PORT = '15037'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Name U -Namespace TsWin -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c);'
[Console]::OutputEncoding = [Text.Encoding]::UTF8   # 봇(node)이 UTF-8로 읽는다(기본 cp949면 글자 깨짐)

function Get-DeviceSerial {
  if ($env:TOWNSHIP_SERIAL) { return $env:TOWNSHIP_SERIAL.Trim() }
  $f = Join-Path $Root 'setup-local\device.json'
  if (Test-Path $f) { try { $s = (Get-Content -Raw -Encoding UTF8 $f | ConvertFrom-Json).serial; if ($s) { return "$s".Trim() } } catch {} }
  return $null
}
function Get-Root {
  $p = Get-Process TownshipMonitor -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return $null }
  # [2026-10-18] 창이 최소화돼 있으면 UI 요소가 0개로 읽혀 상태가 빈칸 → 자동 일시정지(PROCESS_TIMEOUT)를 1시간 넘게 못 봤다. 활성화 없이 복원.
  if ([TsWin.U]::IsIconic($p.MainWindowHandle)) { [TsWin.U]::ShowWindowAsync($p.MainWindowHandle, 4) | Out-Null; Start-Sleep 1 }
  [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}
function Get-Button($name) {
  $r = Get-Root; if (-not $r) { return $null }
  $c = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $r.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
}
function Invoke-Button($name) { (Get-Button $name).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
function Test-Enabled($name) { try { return [bool](Get-Button $name).Current.IsEnabled } catch { return $false } }
# 상태 글자 첫 줄로 판단한다('일시중지' 버튼은 멈춘 상태에서도 활성화돼 있음, 10-18 실측).
function Get-Status {
  # [2026-10-18] 모니터가 쓰는 runtime\monitor-status.json을 먼저 본다(60초 안 갱신 + 같은 프로세스). 없거나 오래되면 창에서 읽기.
  try {
    $j = Get-Content (Join-Path $Root 'runtime\monitor-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (((Get-Date) - [datetime]$j.updatedAt).TotalSeconds -lt 60 -and (Get-Process -Id $j.pid -ErrorAction SilentlyContinue)) { return [string]$j.status }
  } catch {}
  $r = Get-Root; if (-not $r) { return $null }
  $r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
    Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Text' } | Select-Object -First 1 | ForEach-Object { $_.Current.Name }
}
function Test-Running { return ([string](Get-Status) -match '^실행 중') }
function Wait-Enabled($name, $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) { if (Test-Enabled $name) { return $true }; Start-Sleep 1 }
  return $false
}
function Start-Monitor {
  if (Get-Root) { return $true }
  # 감시와 같은 방식: 탐색기 경유로 띄워 이 봇 프로세스 트리 밖에서 돌게 한다.
  Start-Process explorer.exe (Join-Path $PSScriptRoot 'Start-TownshipCF.cmd')
  for ($i = 0; $i -lt 90; $i++) { if (Get-Root) { return $true }; Start-Sleep 1 }
  return $false
}

try {
  switch ($Action) {
    'start' {
      if (-not (Start-Monitor)) { 'X 모니터 창이 뜨지 않았습니다'; exit 1 }
      if (Test-Running) { 'O 이미 실행 중입니다'; exit 0 }
      # [2026-10-18] 오류로 멈춘 상태('일시정지 · PROCESS_ABORTED' 등)는 시작만 눌러선 안 풀린다 → 프로그램 재시작 먼저.
      for ($try = 0; $try -lt 2; $try++) {
        if ([string](Get-Status) -match ' · ') {
          $old = (Get-Process TownshipMonitor -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).Id
          if (Wait-Enabled '프로그램 재시작' 30) { Invoke-Button '프로그램 재시작' }
          for ($i = 0; $i -lt 60 -and (Get-Process -Id $old -ErrorAction SilentlyContinue); $i++) { Start-Sleep 1 }
          Start-Sleep 3
        }
        if (-not (Wait-Enabled '시작' 120)) { 'X 시작 버튼이 활성화되지 않았습니다'; exit 1 }
        Invoke-Button '시작'
        # [2026-10-18] 실제로 '실행 중'이 됐는지 확인하고 답한다(게임 실행·전면 대기 최대 60초 포함).
        for ($i = 0; $i -lt 90; $i++) {
          Start-Sleep 1
          if (Test-Running) { 'O 실행 중 확인: ' + (Get-Status); exit 0 }
        }
        if ([string](Get-Status) -notmatch ' · ') { break }
      }
      'X 90초 안에 실행 중이 안 됨: ' + (Get-Status); exit 1
    }
    'status' { [string](Get-Status) }
    'stop' {
      $msg = @()
      if (-not (Get-Root)) { $msg += '모니터 꺼져 있음' }
      elseif (Test-Running) { Invoke-Button '일시중지'; $msg += '모니터 일시중지' }
      else { $msg += '모니터 이미 멈춤' }
      $serial = Get-DeviceSerial
      # [2026-10-19 사용자 결정] force-stop은 진행이 저장 안 될 수 있다 → 뒤로가기로 마을까지 나간 뒤 'Are you sure?' YES로 정상 종료. 못 찾으면 force-stop.
      if ($serial) {
        Start-Sleep 2
        $r = & node (Join-Path $PSScriptRoot 'graceful-quit.mjs') $serial 2>$null
        if ("$r" -eq 'quit') { $msg += '게임 정상 종료' }
        else { & $Adb -s $serial shell am force-stop com.playrix.township 2>$null | Out-Null; $msg += '게임 강제 종료(종료 확인창 못 찾음)' }
      }
      else { $msg += '폰 시리얼 없음(게임 종료 못함)' }
      'O ' + ($msg -join ', ')
    }
  }
} catch { 'X 오류: ' + $_.Exception.Message; exit 1 }
