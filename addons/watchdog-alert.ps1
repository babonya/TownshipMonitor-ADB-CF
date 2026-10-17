# [2026-10-17] 감시 알림·시간당 요약 로직(watchdog.ps1이 dot-source). 부작용 없는 함수 위주라 -SelfTest 없이도 따로 검증 가능.
# 호출하는 쪽이 $AlertLog, $HourlyLog 경로를 정의해야 한다. 알림 문구는 맨 앞에 [꿈마].

function New-AlertState($now) {
  @{
    Count = 0              # 현재 정지 에피소드에서 감지·재시작한 횟수
    LastRestartAt = $null
    RestartTimes = New-Object System.Collections.ArrayList   # 최근 재시작 시각(시간당 집계용)
    ZeroAlerted = $false   # 납품 0 알림 중복 억제(증가하면 해제)
    MonitorMissingAlerted = $false
    RelayMissingAlerted = $false
    LastTotal = $null; LastDate = $null
    NextHourly = $now.AddHours(1)
  }
}

# 정지를 감지해 재시작한 직후 호출. 반환: 보낼 알림 문구 배열.
function Register-Restart($S, $now, $why, $status, $shot) {
  $S.Count++; $S.LastRestartAt = $now; [void]$S.RestartTimes.Add($now)
  $msgs = @()
  $shotName = if ($shot) { Split-Path -Leaf $shot } else { '없음' }
  $desc = Get-CodeDescription $status
  $st = if ($desc) { "$status ($desc)" } else { $status }
  # 사진 파일이 있으면 알림에 붙는다(문구, 사진경로 쌍). 없으면 사진경로는 $null.
  $photo = if ($shot -and (Test-Path $shot)) { $shot } else { $null }
  if ($S.Count -eq 1) {
    $msgs += @{ Text = "[꿈마] 정지 감지해 재시작했습니다. 사유: $why`n상태: $st / 화면: $shotName"; Photo = $photo }
  } elseif ($S.Count -eq 3) {
    $msgs += @{ Text = "[꿈마] 재시작 2회 뒤에도 같은 정지가 계속됩니다(자동 복구 실패). 사람 확인 필요.`n사유: $why / 상태: $st / 화면: $shotName"; Photo = $photo }
  }
  return ,$msgs
}

# 상태 문자열('실행 중 · CODE')의 코드를 짧은 한국어로 설명. 모르는 코드·코드 없음은 빈 문자열.
function Get-CodeDescription($status) {
  if (-not $status) { return '' }
  $m = [regex]::Match([string]$status, '·\s*([A-Z][A-Z0-9_]+)')
  if (-not $m.Success) { return '' }
  switch ($m.Groups[1].Value) {
    'SOM_SCREEN_UNIDENTIFIED' { return '모르는 화면(팝업 등)' }
    'SOM_HTTP_502' { return 'AI 중계기 오류' }
    'SOM_RESULT_REVIEW_REQUIRED' { return '입력 결과 확인 불가' }
    'SOM_CURRENT_SCREEN_REQUIRED' { return '현재 화면 확인 필요' }
    'PROCESS_TIMEOUT' { return 'adb 시간초과' }
    default { return '' }
  }
}

# 매 순회 호출. 입력이 정상으로 돌아왔으면(재시작 뒤 15분 이상 지나고 무입력 < 기준, 헛돌기 아님) '복구됨' 한 번.
function Test-Recovery($S, $now, $idleMin, $isLoop, $stallMin) {
  $msgs = @()
  if ($S.Count -gt 0 -and $S.LastRestartAt -and ($now - $S.LastRestartAt).TotalMinutes -ge 15 -and $idleMin -lt $stallMin -and -not $isLoop) {
    $msgs += "[꿈마] 복구됨: 입력이 다시 정상입니다(재시작 $($S.Count)회)."
    $S.Count = 0
  }
  return ,$msgs
}

# 모니터·중계기 프로세스 소실. 소실 시 한 번만, 다시 살아나면 해제. 재시작은 하지 않는다.
function Test-Processes($S, $monitorUp, $relayUp) {
  $msgs = @()
  if (-not $monitorUp) { if (-not $S.MonitorMissingAlerted) { $S.MonitorMissingAlerted = $true; $msgs += '[꿈마] 모니터(TownshipMonitor) 프로세스가 없습니다. 다시 켜지 않았습니다.' } } else { $S.MonitorMissingAlerted = $false }
  if (-not $relayUp) { if (-not $S.RelayMissingAlerted) { $S.RelayMissingAlerted = $true; $msgs += '[꿈마] 중계기(cf-som-proxy) 프로세스가 없습니다. 다시 켜지 않았습니다.' } } else { $S.RelayMissingAlerted = $false }
  return ,$msgs
}

# 1시간마다 호출. 반환 @{ Line; Msgs }. 판정: 이상(납품 0·복구 실패 중·프로세스 없음) / 주의(1시간 내 재시작·헛돌기·일시정지) / 정상.
function Get-HourlyReport($S, $now, $date, $total, $phase, $reason, $isLoop, $status, $monitorUp, $relayUp) {
  $delta = $null
  if ($null -ne $S.LastTotal) { $delta = if ($S.LastDate -eq $date -and $total -ge $S.LastTotal) { $total - $S.LastTotal } else { $total } }
  $S.LastTotal = $total; $S.LastDate = $date
  $cut = $now.AddHours(-1)
  $keep = @($S.RestartTimes | Where-Object { $_ -gt $cut })
  $recent = $keep.Count
  $S.RestartTimes.Clear(); foreach ($t in $keep) { [void]$S.RestartTimes.Add($t) }
  $verdict = '정상'
  if ($recent -gt 0 -or $isLoop -or ($status -and $status.StartsWith('일시정지'))) { $verdict = '주의' }
  if ($S.Count -ge 3 -or $delta -eq 0 -or -not $monitorUp -or -not $relayUp) { $verdict = '이상' }
  $msgs = @()
  if ($delta -eq 0) {
    if (-not $S.ZeroAlerted) { $S.ZeroAlerted = $true; $msgs += "[꿈마] 지난 1시간 납품 증가 0건입니다(오늘 $total). 상태: $status / $phase $reason" }
  } elseif ($null -ne $delta) { $S.ZeroAlerted = $false }
  $dtxt = if ($null -eq $delta) { '?' } else { "+$delta" }
  $loopTxt = if ($isLoop) { '예' } else { '아니오' }
  if (-not $reason) { $reason = '-' }
  $line = "{0} 납품 {1}({2}/h) 재시작 {3} phase={4} reason={5} 헛돌기={6} 판정={7}" -f $now.ToString('yyyy-MM-dd HH:mm:ss'), $total, $dtxt, $recent, $phase, $reason, $loopTxt, $verdict
  $S.NextHourly = $now.AddHours(1)
  return @{ Line = $line; Msgs = $msgs; Recent = $recent }
}

function Get-TelegramConfig {
  $t = $env:TELEGRAM_BOT_TOKEN; $c = $env:TELEGRAM_CHAT_ID
  if (-not $t) { $t = [Environment]::GetEnvironmentVariable('TELEGRAM_BOT_TOKEN', 'User') }
  if (-not $c) { $c = [Environment]::GetEnvironmentVariable('TELEGRAM_CHAT_ID', 'User') }
  if ($t -and $c) { return @{ Token = $t; ChatId = $c } }
  return $null
}

# 알림 한 건: alerts.log 기록 + 텔레그램 푸시. 어떤 실패도 감시를 멈추지 않는다. 토큰은 절대 기록하지 않는다.
function Send-TelegramPhoto($cfg, $text, $photo) {
  # curl.exe로 sendPhoto. 한글 caption은 UTF-8(BOM 없음) 임시파일로 넘긴다. 성공 시 $true, 실패 시 $false(토큰 미노출).
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("wd-caption-{0}.txt" -f [guid]::NewGuid().ToString('N'))
  try {
    $cap = if ($text.Length -gt 1000) { $text.Substring(0, 1000) } else { $text }   # 텔레그램 caption 한도 1024자
    [IO.File]::WriteAllText($tmp, $cap, (New-Object Text.UTF8Encoding($false)))
    $resp = & curl.exe -s -m 30 -F "chat_id=$($cfg.ChatId)" -F "caption=<$tmp" -F "photo=@$photo" ("https://api.telegram.org/bot{0}/sendPhoto" -f $cfg.Token) 2>$null
    $json = ($resp | Out-String)
    return ($json -match '"ok"\s*:\s*true')
  } catch { return $false }
  finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# $photo: 선택(파일 경로). 있고 크기>0이면 sendPhoto(caption=$text), 실패하면 sendMessage로 대체.
# $photoSender: 시험용 가짜 사진 전송기 { param($cfg,$text,$photo) → $true/$false }
function Send-Alert($text, $sender = $null, $photo = $null, $photoSender = $null) {
  $note = ''
  try {
    $cfg = Get-TelegramConfig
    if (-not $cfg) { $note = ' (텔레그램 미설정)' }
    else {
      try {
        $sentPhoto = $false
        if ($photo -and (Test-Path -LiteralPath $photo -PathType Leaf) -and ((Get-Item -LiteralPath $photo).Length -gt 0)) {
          if ($photoSender) { $sentPhoto = [bool](& $photoSender $cfg $text $photo) } else { $sentPhoto = Send-TelegramPhoto $cfg $text $photo }
          if (-not $sentPhoto) { $note = ' (사진 전송 실패, 글로 대체)' }
        }
        if ($sentPhoto) { $note = ' (텔레그램 사진 전송됨)' }
        else {
          if ($sender) { & $sender $cfg $text }
          else {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $body = [Text.Encoding]::UTF8.GetBytes((@{ chat_id = $cfg.ChatId; text = $text } | ConvertTo-Json -Compress))
            Invoke-RestMethod -Uri ("https://api.telegram.org/bot{0}/sendMessage" -f $cfg.Token) -Method Post -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 10 | Out-Null
          }
          $note = $note + ' (텔레그램 전송됨)'
        }
      } catch {
        $m = [string]$_.Exception.Message
        if ($cfg.Token) { $m = $m.Replace($cfg.Token, '***') }
        $note = " (텔레그램 전송 실패: $m)"
      }
    }
  } catch { $note = ' (알림 처리 오류)' }
  try { Add-Content -Path $AlertLog -Value ("{0} {1}{2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), ($text -replace "`r?`n", ' | '), $note) -Encoding UTF8 } catch {}
}
