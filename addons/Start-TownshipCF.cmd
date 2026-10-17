@echo off
rem Wrapper for Start-ADB.cmd: pin adb server port 15037, start Cloudflare SOM proxy on 8087
cd /d "%~dp0.."
set ANDROID_ADB_SERVER_PORT=15037
if "%CLOUDFLARE_ACCOUNT_ID%"=="" (
  echo CLOUDFLARE_ACCOUNT_ID is not set.
  pause
  exit /b 1
)
curl.exe -s -o nul -w "%%{http_code}" http://127.0.0.1:8087/health 2>nul | findstr 200 >nul
if errorlevel 1 (
  start "cf-som proxy" /min cmd /k "set CF_SOM_LOG=1&& node addons\cf-som-proxy.mjs"
  for /l %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    curl.exe -s -o nul -w "%%{http_code}" http://127.0.0.1:8087/health 2>nul | findstr 200 >nul && goto ready
  )
  echo SOM proxy did not answer on 127.0.0.1:8087.
  pause
  exit /b 1
)
:ready
rem Bot watchdog (auto restart when stuck, user decision 2026-10-15). See addons\watchdog.ps1
call "%~dp0Start-Watchdog.cmd"
call "%~dp0..\Start-ADB.cmd"
