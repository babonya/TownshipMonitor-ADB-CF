@echo off
rem Start only the Cloudflare SOM proxy (port 8087) in its own minimized window. Start-TownshipCF.cmd also starts it when missing.
cd /d "%~dp0.."
start "cf-som proxy" /min cmd /k "set CF_SOM_LOG=1&& node addons\cf-som-proxy.mjs"
