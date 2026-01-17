@echo off
setlocal enabledelayedexpansion
title SwellDreams

REM SwellDreams Production Startup Script

REM Get script directory
set SCRIPT_DIR=%~dp0

REM Stop any existing instance first
echo Stopping any existing SwellDreams instance...
taskkill /FI "WINDOWTITLE eq SwellDreams*" /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8889 "') do (
    if not "%%a"=="" (
        taskkill /F /PID %%a >nul 2>&1
    )
)
timeout /t 1 /nobreak >nul

REM Read version (simplified for batch)
echo.
echo ========================================
echo   SwellDreams v2.5b Production Server
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo Node.js not found. Attempting to install...

    REM Try winget first (Windows 10/11)
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        echo Using winget to install Node.js...
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        goto :check_node_again
    )

    REM Try chocolatey
    where choco >nul 2>&1
    if !errorlevel! equ 0 (
        echo Using Chocolatey to install Node.js...
        choco install nodejs-lts -y
        goto :check_node_again
    )

    echo Error: Could not install Node.js automatically.
    echo Please install Node.js manually from https://nodejs.org/
    pause
    exit /b 1
)

:check_node_again
REM Refresh PATH and verify
call refreshenv >nul 2>&1
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo Error: Node.js installation may require a restart.
    echo Please restart your terminal and run this script again.
    pause
    exit /b 1
)
echo Node.js found:
node --version

REM Check if Python is installed (optional - only warn)
where python >nul 2>&1
if !errorlevel! neq 0 (
    echo Warning: Python not found. Some features may be limited.
) else (
    REM Install Python dependencies
    echo Installing Python dependencies...
    py -m pip install -q -r "%SCRIPT_DIR%backend\requirements.txt" 2>nul
    if !errorlevel! neq 0 (
        pip install -q -r "%SCRIPT_DIR%backend\requirements.txt" 2>nul
    )
)

REM Install/update backend dependencies
echo Checking backend dependencies...
cd /d "%SCRIPT_DIR%backend"
call npm install

REM Install/update frontend dependencies
echo Checking frontend dependencies...
cd /d "%SCRIPT_DIR%frontend"
call npm install

REM Remove old build and rebuild frontend to ensure fresh code
echo Removing old frontend build...
cd /d "%SCRIPT_DIR%frontend"
if exist "build" rmdir /s /q "build"
echo Building frontend for production...
call npm run build

REM Start server in new window (visible for debug output)
echo Starting SwellDreams server...
start "SwellDreams Server" cmd /k "cd /d %SCRIPT_DIR%backend && node server.js"

REM Wait for server
timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo   SwellDreams v2.5b is running!
echo   http://localhost:8889
echo ========================================
echo.

REM Open browser
echo Opening browser...
start "" "http://localhost:8889"

echo To stop: run stop.bat
echo.
pause
