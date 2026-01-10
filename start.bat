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

REM Start backend in new window
echo Starting backend server...
start "SwellDreams Backend" cmd /c "cd /d "%SCRIPT_DIR%backend" && node server.js"

REM Wait for backend
timeout /t 2 /nobreak >nul

REM Start frontend
echo Starting frontend...
cd /d "%SCRIPT_DIR%frontend"
call npm start

echo.
echo SwellDreams is running!
echo   Backend:  http://localhost:8889
echo   Frontend: http://localhost:3001
echo.
pause
