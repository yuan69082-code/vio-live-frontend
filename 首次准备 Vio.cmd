@echo off
setlocal
cd /d "%~dp0"
node "scripts\windows\prepare-local-runtime.js" %*
set "VIO_EXIT_CODE=%ERRORLEVEL%"
if not "%VIO_EXIT_CODE%"=="0" (
  echo.
  echo Vio first-time preparation did not complete. No service was started.
  pause
)
endlocal & exit /b %VIO_EXIT_CODE%
