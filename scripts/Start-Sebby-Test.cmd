@echo off
setlocal
pushd "%~dp0" || exit /b 1
if not exist "runtime\node.exe" (
  echo Extract the entire Sebby test ZIP to a folder, then run this file again.
  goto failed
)
"runtime\node.exe" "scripts\start-local.mjs" --prebuilt %*
if errorlevel 1 goto failed
popd
exit /b 0
:failed
if not "%SEBBY_LAUNCHER_NO_PAUSE%"=="1" pause
popd
exit /b 1
