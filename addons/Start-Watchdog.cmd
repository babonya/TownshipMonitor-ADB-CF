@echo off
rem Start the bot watchdog minimized (exits at once if one is already running). See addons\watchdog.ps1
start "township watchdog" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1"
