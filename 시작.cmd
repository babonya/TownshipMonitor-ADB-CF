@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Keep this file ASCII only: Korean Windows (cp949) misreads UTF-8 Korean lines in .cmd files (DC feedback 2026-10-17).
rem A window opened from Explorer may not see newly saved user env vars, so read them from the registry.
for %%V in (CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_AUTH_TOKEN TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID) do (
  for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v %%V 2^>nul ^| findstr /i "REG_"') do set "%%V=%%b"
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0addons\setup\Setup-Township.ps1" -Quick
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
call "%~dp0addons\Start-TownshipCF.cmd"
