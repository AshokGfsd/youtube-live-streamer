@echo off
setlocal enabledelayedexpansion

title StreamForge Studio (Windows)

echo ====================================================================
echo                 StreamForge Studio - Windows Launcher
echo ====================================================================
echo.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

:: 1. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js 22+ from https://nodejs.org or run:
    echo     winget install OpenJS.NodeJS.LTS
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=!NODE_MAJOR:v=!"
if !NODE_MAJOR! LSS 22 (
    echo [WARNING] Node.js version is !NODE_MAJOR!. StreamForge requires Node.js 22 or newer.
    echo Recommended: winget install OpenJS.NodeJS.LTS
)

:: 2. Check FFmpeg and FFprobe
where ffmpeg >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARNING] FFmpeg is not found in PATH.
    echo StreamForge requires FFmpeg to encode and broadcast video to YouTube.
    echo To install FFmpeg on Windows via winget, run in an admin terminal:
    echo     winget install Gyan.FFmpeg
    echo.
)

where ffprobe >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARNING] FFprobe is not found in PATH. Video metadata probing will fail until installed.
    echo Install via: winget install Gyan.FFmpeg
    echo.
)

:: 3. Configure .env if missing
if not exist "apps\api\.env" (
    echo [INFO] Creating apps\api\.env from deploy\windows\.env.example...
    if exist "deploy\windows\.env.example" (
        copy "deploy\windows\.env.example" "apps\api\.env" >nul
    ) else if exist "deploy\termux\.env.example" (
        copy "deploy\termux\.env.example" "apps\api\.env" >nul
    )
    echo [INFO] Environment file created: apps\api\.env
)

:: 4. Ensure dependencies installed
if not exist "node_modules" (
    echo [INFO] Installing project dependencies...
    call npm install --omit=dev --no-audit --no-fund
)

:: 5. Start the server
echo [INFO] Starting StreamForge Studio on http://127.0.0.1:4000...
echo [INFO] Press Ctrl+C to stop the studio.
echo.

:: Open browser after a short delay in background
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:4000"

:: Run the server
cd apps\api
node src\server.js

pause
