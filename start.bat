@echo off
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

REM Read version
echo.
echo ========================================
echo   SwellDreams v2.5b Production Server
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js found:
node --version

REM Check if Python is installed (optional)
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Warning: Python not found. Some features may be limited.
) else (
    echo Installing Python dependencies...
    py -m pip install -q -r "%SCRIPT_DIR%backend\requirements.txt" 2>nul
)

REM Install/update backend dependencies
echo Checking backend dependencies...
cd /d "%SCRIPT_DIR%backend"
call npm install

REM Install/update frontend dependencies
echo Checking frontend dependencies...
cd /d "%SCRIPT_DIR%frontend"
call npm install

REM Remove old build and rebuild frontend
echo Removing old frontend build...
cd /d "%SCRIPT_DIR%frontend"
if exist "build" rmdir /s /q "build"
echo Building frontend for production...
call npm run build

REM Start server in new window
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
