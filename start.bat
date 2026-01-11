@echo off
title SwellDreams

REM SwellDreams Production Startup Script

REM Get script directory
set SCRIPT_DIR=%~dp0

REM Read version (simplified for batch)
echo.
echo ========================================
echo   SwellDreams v1.0b Production Server
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

REM Install/update backend dependencies
echo Checking backend dependencies...
cd /d "%SCRIPT_DIR%backend"
call npm install

REM Install/update frontend dependencies
echo Checking frontend dependencies...
cd /d "%SCRIPT_DIR%frontend"
call npm install

REM Build frontend (always rebuild to ensure latest changes)
echo Building frontend for production...
cd /d "%SCRIPT_DIR%frontend"
call npm run build

REM Start backend in new window
echo Starting backend server...
start "SwellDreams-Backend" /MIN cmd /c "cd /d %SCRIPT_DIR%backend && node server.js"

REM Wait for backend
timeout /t 2 /nobreak >nul

REM Start frontend production server
echo Starting frontend server...
start "SwellDreams-Frontend" /MIN cmd /c "cd /d %SCRIPT_DIR%frontend && npx serve -s build -l 3001"

echo.
echo ========================================
echo   SwellDreams v1.0b is running!
echo   Backend:  http://localhost:8889
echo   Frontend: http://localhost:3001
echo ========================================
echo.

REM Open browser
echo Opening browser...
start "" "http://localhost:3001"

echo To stop: run stop.bat
echo.
pause
