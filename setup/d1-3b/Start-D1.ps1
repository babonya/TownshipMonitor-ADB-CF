param([ValidateRange(1024,65535)][int]$Port = 8087)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$exe = Join-Path $root 'runtime\llama-server.exe'
$model = Join-Path $root 'models\d1-3B-Q8_0.gguf'
$projector = Join-Path $root 'models\mmproj-d1-3B-F16.gguf'
$stateFile = Join-Path $root 'server-process.json'
$baseUrl = "http://127.0.0.1:$Port"
foreach ($path in @($exe,$model,$projector)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing installation file: $path" }
}
if (Test-Path -LiteralPath $stateFile) {
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $saved.processId -ErrorAction SilentlyContinue
    if ($existing -and $existing.Path -eq $exe -and $existing.StartTime.ToUniversalTime().ToString('o') -eq $saved.startTimeUtc) {
        if ($saved.port -ne $Port) { throw "D1 is already running on port $($saved.port). Run Stop-D1.ps1 first." }
        $health = Invoke-RestMethod "$baseUrl/health" -TimeoutSec 5
        if ($health.status -eq 'ok') { Write-Output "D1 is already running: $baseUrl/v1/systemone"; return }
        throw 'The existing D1 process is not healthy. Inspect logs before restarting.'
    }
}
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "Port $Port is already in use. Choose another -Port; no process was stopped." }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$stdout = Join-Path $root "logs\server-$stamp.stdout.log"
$stderr = Join-Path $root "logs\server-$stamp.stderr.log"
$serverArgs = @('-m',('"'+$model+'"'),'--mmproj',('"'+$projector+'"'),
    '--host','127.0.0.1','--port',"$Port",'--alias','d1-3b',
    '--gpu-layers','99','--ctx-size','4096','--batch-size','2048',
    '--ubatch-size','512','--parallel','1','--no-webui')
$process = Start-Process -FilePath $exe -ArgumentList $serverArgs -WorkingDirectory (Join-Path $root 'runtime') -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$process.Refresh()
[ordered]@{processId=$process.Id;startTimeUtc=$process.StartTime.ToUniversalTime().ToString('o');executable=$exe;port=$Port;baseUrl=$baseUrl;stdout=$stdout;stderr=$stderr} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) { throw "D1 exited with code $($process.ExitCode). Inspect $stderr" }
    try {
        $health = Invoke-RestMethod "$baseUrl/health" -TimeoutSec 2
        if ($health.status -eq 'ok') { Write-Output "D1 ready: $baseUrl/v1/systemone (PID $($process.Id))"; return }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw "D1 is still loading. Inspect $stderr and $baseUrl/health. The process has been left running."
