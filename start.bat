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

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Python is not installed. Please install Python first.
    pause
    exit /b 1
)

REM Install backend dependencies if needed
if not exist "%SCRIPT_DIR%backend\node_modules" (
    echo Installing backend dependencies...
    cd /d "%SCRIPT_DIR%backend"
    call npm install
)

REM Install frontend dependencies if needed
if not exist "%SCRIPT_DIR%frontend\node_modules" (
    echo Installing frontend dependencies...
    cd /d "%SCRIPT_DIR%frontend"
    call npm install
)

REM Build frontend if needed
if not exist "%SCRIPT_DIR%frontend\build" (
    echo Building frontend for production...
    cd /d "%SCRIPT_DIR%frontend"
    call npm run build
)

REM Start backend in new window
echo Starting backend server...
start "SwellDreams-Backend" /MIN cmd /c "cd /d "%SCRIPT_DIR%backend" && node server.js"

REM Wait for backend
timeout /t 2 /nobreak >nul

REM Start frontend production server
echo Starting frontend server...
start "SwellDreams-Frontend" /MIN cmd /c "cd /d "%SCRIPT_DIR%frontend" && npm run serve"

echo.
echo ========================================
echo   SwellDreams v1.0b is running!
echo   Backend:  http://localhost:8889
echo   Frontend: http://localhost:3001
echo ========================================
echo.
echo To stop: run stop.bat
echo.
pause
