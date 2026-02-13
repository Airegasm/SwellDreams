@echo off
title SwellDreams Startup

echo SwellDreams Production Startup Script
echo.

REM Get script directory
set SCRIPT_DIR=%~dp0
echo Script directory: %SCRIPT_DIR%

REM Read version from version.json
set VERSION=3.6.0
set CODENAME=FinalClosed
for /f "tokens=2 delims=:," %%a in ('type "%SCRIPT_DIR%version.json" ^| findstr /c:"\"version\""') do (
    set VERSION=%%~a
)
for /f "tokens=2 delims=:," %%a in ('type "%SCRIPT_DIR%version.json" ^| findstr /c:"\"codename\""') do (
    set CODENAME=%%~a
)
REM Trim spaces
set VERSION=%VERSION: =%
set CODENAME=%CODENAME: =%

REM Note: Automatic server stopping disabled to prevent killing other node processes
REM If you need to stop the server, use stop.bat before running start.bat
REM Or manually close the "SwellDreams Server" window
echo Checking for existing SwellDreams server...
tasklist /FI "WINDOWTITLE eq SwellDreams Server*" /FO LIST 2>nul | findstr /C:"PID:" >nul
if not errorlevel 1 (
    echo Warning: A SwellDreams Server window may already be running.
    echo Close it manually or run stop.bat first to avoid conflicts.
    echo.
    timeout /t 3 /nobreak >nul
)

echo.
echo ========================================
echo   SwellDreams v%VERSION% %CODENAME%
echo ========================================
echo.

REM Auto-update from git
echo Checking for updates...
cd /d "%SCRIPT_DIR%"
git pull
if errorlevel 1 (
    echo Warning: Could not update from git. Continuing with local version...
) else (
    echo Update complete!
)
echo.

REM Check if Node.js is installed
echo Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js not found. Please install from https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js found:
node --version

REM Check Python and install dependencies
echo.
echo Checking for Python...
where python >nul 2>nul
if errorlevel 1 (
    echo Warning: Python not found. Some features ^(Wyze, Tapo, Matter^) will be unavailable.
    echo Install Python from https://www.python.org/downloads/
) else (
    python --version
    echo Installing/updating Python dependencies ^(Wyze, Tapo, Matter^)...
    python -m pip install --upgrade pip >nul 2>nul
    python -m pip install -r "%SCRIPT_DIR%backend\requirements.txt"
    if errorlevel 1 (
        echo Warning: Some Python dependencies failed to install. Matter features may be limited.
    ) else (
        echo Python dependencies installed successfully!
    )
)

REM Check for WSL (Matter support will auto-install on first use)
wsl --list >nul 2>nul
if errorlevel 1 (
    echo Note: WSL not detected. Matter/Tapo support will be unavailable.
) else (
    echo WSL detected. Matter support available ^(will auto-install on first use^).
)

REM Install/update backend dependencies
echo.
echo Checking backend dependencies...
cd /d "%SCRIPT_DIR%backend"
if not exist "package.json" (
    echo ERROR: backend/package.json not found!
    pause
    exit /b 1
)
call npm install
if errorlevel 1 (
    echo ERROR: Backend npm install failed!
    pause
    exit /b 1
)

REM Install/update frontend dependencies
echo.
echo Checking frontend dependencies...
cd /d "%SCRIPT_DIR%frontend"
if not exist "package.json" (
    echo ERROR: frontend/package.json not found!
    pause
    exit /b 1
)
call npm install
if errorlevel 1 (
    echo ERROR: Frontend npm install failed!
    pause
    exit /b 1
)

REM Remove old build and rebuild frontend
echo.
echo Removing old frontend build...
if exist "build" rmdir /s /q "build"
echo Building frontend for production...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)

REM Start server in new window
echo.
echo Starting SwellDreams server...
start "SwellDreams Server" cmd /k "cd /d %SCRIPT_DIR%backend && node server.js"

REM Wait for server
timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo   SwellDreams v%VERSION% is running!
echo   http://localhost:8889
echo ========================================
echo.

REM Open browser
echo Opening browser...
start "" "http://localhost:8889"

echo To stop: run stop.bat
echo.
pause
