$ErrorActionPreference = 'Stop'
# Read-only process check. A helper still alive may be finishing input cleanup.
$helpers = @(Get-Process -Name TownshipDesktopBridge -ErrorAction SilentlyContinue)
@{ idle = ($helpers.Count -eq 0) } | ConvertTo-Json -Compress
