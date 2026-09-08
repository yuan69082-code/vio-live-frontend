@echo off
setlocal
cd /d "%~dp0"
node "scripts\windows\vio-local.js" stop %*
set "VIO_EXIT_CODE=%ERRORLEVEL%"
if not "%VIO_EXIT_CODE%"=="0" (
  echo.
  echo Vio could not prove ownership, so no process was stopped.
  pause
)
endlocal & exit /b %VIO_EXIT_CODE%
