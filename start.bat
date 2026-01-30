@echo off
title SwellDreams Startup

echo SwellDreams Production Startup Script
echo.

REM Get script directory
set SCRIPT_DIR=%~dp0
echo Script directory: %SCRIPT_DIR%

REM Read version from version.json
set VERSION=unknown
set CODENAME=
for /f "tokens=2 delims=:," %%a in ('type "%SCRIPT_DIR%version.json" ^| findstr /c:"\"version\""') do (
    set VERSION=%%~a
)
for /f "tokens=2 delims=:," %%a in ('type "%SCRIPT_DIR%version.json" ^| findstr /c:"\"codename\""') do (
    set CODENAME=%%~a
)
REM Trim spaces
set VERSION=%VERSION: =%
set CODENAME=%CODENAME: =%

REM Stop any existing SERVER instance (not this startup window)
echo Stopping any existing SwellDreams server...
taskkill /FI "WINDOWTITLE eq SwellDreams Server*" /F >nul 2>&1

echo.
echo ========================================
echo   SwellDreams v%VERSION% %CODENAME%
echo ========================================
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

REM Check Python (optional)
echo Checking for Python...
where python >nul 2>nul
if errorlevel 1 (
    echo Warning: Python not found. Some features may be limited.
) else (
    echo Installing Python dependencies...
    python -m pip install -q -r "%SCRIPT_DIR%backend\requirements.txt" 2>nul
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
