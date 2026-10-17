@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-D1.ps1" %*
if errorlevel 1 pause
