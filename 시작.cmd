@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 탐색기에서 연 창은 새로 저장한 사용자 환경변수를 모를 수 있어 레지스트리에서 직접 읽어 넣는다.
for %%V in (CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_AUTH_TOKEN TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID) do (
  for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v %%V 2^>nul ^| findstr /i "REG_"') do set "%%V=%%b"
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0addons\setup\Setup-Township.ps1" -Quick
if errorlevel 1 (
  echo.
  echo 준비가 덜 됐습니다. 먼저 처음설정.cmd 를 실행하세요. (자세한 확인은 점검.cmd)
  pause
  exit /b 1
)
call "%~dp0addons\Start-TownshipCF.cmd"
