@echo off
title SwellDreams

echo Starting SwellDreams...

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

REM Get script directory
set SCRIPT_DIR=%~dp0

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

REM Start backend in new window with title for easy identification
echo Starting backend server...
start "SwellDreams-Backend" /MIN cmd /c "cd /d "%SCRIPT_DIR%backend" && node server.js"

REM Wait for backend
timeout /t 2 /nobreak >nul

REM Start frontend in new window
echo Starting frontend...
start "SwellDreams-Frontend" /MIN cmd /c "cd /d "%SCRIPT_DIR%frontend" && set PORT=3001 && npm start"

echo.
echo ========================================
echo SwellDreams is running!
echo   Backend:  http://localhost:8889
echo   Frontend: http://localhost:3001
echo ========================================
echo.
echo To stop: run stop.bat or close the
echo SwellDreams-Backend and SwellDreams-Frontend windows
echo.
pause
