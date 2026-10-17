$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot 'server-process.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output 'No D1 process record.'; return }
$saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $saved.processId -ErrorAction SilentlyContinue
if (-not $process) { Write-Output 'D1 is already stopped.'; return }
$expectedExe = Join-Path $PSScriptRoot 'runtime\llama-server.exe'
if ($process.Path -ne $expectedExe -or $process.StartTime.ToUniversalTime().ToString('o') -ne $saved.startTimeUtc) {
    throw 'The recorded PID now belongs to another process; nothing was stopped.'
}
Stop-Process -Id $process.Id
Write-Output 'D1 stopped; its GPU memory will be released.'
