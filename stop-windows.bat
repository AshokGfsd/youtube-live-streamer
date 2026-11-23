@echo off
setlocal enabledelayedexpansion

echo ====================================================================
echo                 StreamForge Studio - Windows Stopper
echo ====================================================================
echo.

set "PORT=4000"
echo [INFO] Looking for process listening on port %PORT%...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    set "PID=%%a"
    echo [INFO] Stopping process on port %PORT% (PID: !PID!)...
    taskkill /F /PID !PID! >nul 2>&1
    echo [SUCCESS] StreamForge server stopped.
    goto :done
)

echo [INFO] No StreamForge process found listening on port %PORT%.

:done
echo.
pause
