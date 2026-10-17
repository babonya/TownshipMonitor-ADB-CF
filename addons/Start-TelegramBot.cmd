@echo off
rem Telegram bot alone (restart after edits). Started from Start-TownshipCF.cmd normally.
start "township telegram" /min node "%~dp0telegram-bot.mjs"
