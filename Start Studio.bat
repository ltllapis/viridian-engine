@echo off
rem Double-click to start Viridian Studio. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and try again. & pause & exit /b 1)
node studio\server.mjs --open
pause
