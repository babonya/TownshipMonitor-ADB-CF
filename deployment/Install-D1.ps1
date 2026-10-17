param()
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'TownshipAI\d1-3b'
if (Test-Path -LiteralPath $destination) {
    throw "D1 destination already exists: $destination. Inspect/reuse it using readme.txt; this installer does not overwrite an existing service."
}
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'd1-3b\install-manifest.json') -Raw | ConvertFrom-Json
foreach ($dir in @('models','downloads','runtime','logs')) {
    New-Item -ItemType Directory -Path (Join-Path $destination $dir) -Force | Out-Null
}
foreach ($file in $manifest.files) {
    $target = Join-Path (Join-Path $destination $file.directory) $file.name
    $partial = $target + '.partial'
    Write-Output "Downloading $($file.name)"
    Invoke-WebRequest -UseBasicParsing -Uri $file.url -OutFile $partial
    if ((Get-Item -LiteralPath $partial).Length -ne $file.size -or (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
        throw "Download verification failed: $partial. No unverified runtime was executed."
    }
    Move-Item -LiteralPath $partial -Destination $target
    if ($file.directory -eq 'downloads') {
        Expand-Archive -LiteralPath $target -DestinationPath (Join-Path $destination 'runtime') -Force
    }
}
foreach ($name in @('Start-D1.ps1','Stop-D1.ps1','Compare-Images.py','install-manifest.json','MODEL-LICENSE.txt','RUNTIME-LICENSE.txt','UPSTREAM-MODEL-CARD.md')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "d1-3b\$name") -Destination (Join-Path $destination $name)
}
if (-not (Test-Path -LiteralPath (Join-Path $destination 'runtime\llama-server.exe'))) {
    throw 'Archive layout mismatch: expected runtime\llama-server.exe. Inspect the verified archive before starting.'
}
Write-Output "Verified D1 installation ready at $destination. Start-D1.ps1 starts it separately."
