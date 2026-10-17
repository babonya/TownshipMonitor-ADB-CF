param([string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$monitorRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $OutputPath) { $OutputPath = Join-Path $monitorRoot 'artifacts/TownshipMonitor' }
& dotnet publish (Join-Path $PSScriptRoot 'TownshipMonitor.csproj') -c Release --no-self-contained -o $OutputPath --nologo -v minimal
if ($LASTEXITCODE -ne 0) { throw 'Township Monitor 빌드 실패' }
Write-Output (Join-Path $OutputPath 'TownshipMonitor.exe')
