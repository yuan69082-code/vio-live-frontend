@echo off
setlocal
cd /d "%~dp0"
node "scripts\windows\initialize-local-personal.js" %*
set "VIO_EXIT_CODE=%ERRORLEVEL%"
if not "%VIO_EXIT_CODE%"=="0" (
  echo.
  echo Personal space was not initialized. Follow the safe message above; your access passphrase is entered only in the Vio page.
  pause
)
endlocal & exit /b %VIO_EXIT_CODE%
