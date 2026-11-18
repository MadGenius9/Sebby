@echo off
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer from https://nodejs.org/en/download
  echo Then reopen this launcher.
  goto failed
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Repair your Node.js installation, then reopen this launcher.
  goto failed
)
where git >nul 2>nul
if errorlevel 1 (
  echo Install Git from https://git-scm.com/downloads/win and reopen this launcher.
  goto failed
)
call npm.cmd run local -- %*
if errorlevel 1 goto failed
popd
exit /b 0
:failed
if not "%SEBBY_LAUNCHER_NO_PAUSE%"=="1" pause
popd
exit /b 1
