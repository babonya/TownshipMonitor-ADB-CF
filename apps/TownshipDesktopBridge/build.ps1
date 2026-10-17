param([string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot '../../artifacts/TownshipDesktopBridge' }
& dotnet publish (Join-Path $PSScriptRoot 'TownshipDesktopBridge.csproj') -c Release --no-self-contained -o $OutputPath --nologo -v minimal
if ($LASTEXITCODE -ne 0) { throw 'TownshipDesktopBridge build failed' }
