@echo off
setlocal
cd /d "%~dp0"
node "scripts\windows\vio-local.js" start %*
set "VIO_EXIT_CODE=%ERRORLEVEL%"
if not "%VIO_EXIT_CODE%"=="0" (
  echo.
  echo Vio did not start. Review the error above; daily start never installs dependencies.
  pause
)
endlocal & exit /b %VIO_EXIT_CODE%
