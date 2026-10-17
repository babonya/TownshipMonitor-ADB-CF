@echo off
cd /d "%~dp0"
if not exist "runtime\mumu-autonomous-transport\state.json" (
  echo Set up this installation first. See readme.txt.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js and reopen this window. See readme.txt.
  pause
  exit /b 1
)
if not exist ".venv-perception\Scripts\python.exe" (
  echo Create the Python environment first. See readme.txt.
  pause
  exit /b 1
)
start "" "%~dp0artifacts\TownshipMonitor\TownshipMonitor.exe" --root "%~dp0." --source "%~dp0runtime\mumu-autonomous-transport"
