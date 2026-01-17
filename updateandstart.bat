@echo off
title SwellDreams Update and Start

REM SwellDreams Update and Start Script
REM Stops the server, updates from git, then starts fresh

REM Get script directory
set SCRIPT_DIR=%~dp0

echo.
echo ========================================
echo   SwellDreams Update and Start
echo ========================================
echo.

REM Step 1: Stop
echo [1/3] Stopping SwellDreams...
call "%SCRIPT_DIR%stop.bat"

REM Step 2: Update
echo.
echo [2/3] Checking for updates...
call "%SCRIPT_DIR%update.bat"

REM Step 3: Start
echo.
echo [3/3] Starting SwellDreams...
call "%SCRIPT_DIR%start.bat"
