# [사용자 변경 2026-10-18] 텔레그램 /start /stop 로 꿈마 모니터 제어(telegram-bot.mjs가 호출). 결과 한 줄을 stdout으로.
# start   = 모니터 '시작'(꺼진 게임 자동 실행 → 창고부터). 모니터가 없으면 Start-TownshipCF.cmd로 띄운 뒤 '시작'.
# stop    = 모니터 '일시중지'(창은 유지) + 폰 Township 강제 종료. 일시중지 상태는 감시가 건드리지 않는다.
param([Parameter(Mandatory)][ValidateSet('start','stop')][string]$Action)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$env:ANDROID_ADB_SERVER_PORT = '15037'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
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
      if (-not (Wait-Enabled '시작' 120)) { 'X 시작 버튼이 활성화되지 않았습니다'; exit 1 }
      Invoke-Button '시작'
      'O 시작했습니다(게임이 꺼져 있으면 자동 실행 후 창고부터)'
    }
    'stop' {
      $msg = @()
      if (-not (Get-Root)) { $msg += '모니터 꺼져 있음' }
      elseif (Test-Running) { Invoke-Button '일시중지'; $msg += '모니터 일시중지' }
      else { $msg += '모니터 이미 멈춤' }
      $serial = Get-DeviceSerial
      if ($serial) { & $Adb -s $serial shell am force-stop com.playrix.township 2>$null | Out-Null; $msg += '게임 종료' }
      else { $msg += '폰 시리얼 없음(게임 종료 못함)' }
      'O ' + ($msg -join ', ')
    }
  }
} catch { 'X 오류: ' + $_.Exception.Message; exit 1 }
