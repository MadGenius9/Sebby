@echo off
cd /d "%~dp0"
call npm run launch:local
if errorlevel 1 pause
