@echo off
title SwellDreams

REM SwellDreams Production Startup Script

REM Get script directory
set SCRIPT_DIR=%~dp0

REM Read version (simplified for batch)
echo.
echo ========================================
echo   SwellDreams v2.5b Production Server
echo ========================================
echo.

REM Check if Node.js is installed, try to install if not
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Node.js not found. Attempting to install...

    REM Try winget first (Windows 10/11)
    where winget >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        echo Using winget to install Node.js...
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        goto :check_node_again
    )

    REM Try chocolatey
    where choco >nul 2>nul
    if %ERRORLEVEL% equ 0 (
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
call refreshenv >nul 2>nul
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Node.js installation may require a restart.
    echo Please restart your terminal and run this script again.
    pause
    exit /b 1
)
echo Node.js found:
node --version

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Python is not installed. Please install Python first.
    pause
    exit /b 1
)

REM Install Python dependencies
echo Installing Python dependencies...
py -m pip install -q -r "%SCRIPT_DIR%backend\requirements.txt" 2>nul
if %ERRORLEVEL% neq 0 (
    pip install -q -r "%SCRIPT_DIR%backend\requirements.txt" 2>nul
    if %ERRORLEVEL% neq 0 (
        echo Warning: Could not install some Python dependencies. Some features may not work.
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
