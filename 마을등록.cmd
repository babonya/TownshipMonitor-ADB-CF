@echo off
chcp 65001 >nul
cd /d "%~dp0"
".venv-perception\Scripts\python.exe" -I "addons\town-camera\register_town.py" %*
echo.
pause
