@echo off
title SwellDreams Backend
color 0A

:: Configuration
set MAX_CRASHES=5
set CRASH_WINDOW=60
set CRASH_COUNT=0
set LAST_CRASH_TIME=0

echo ========================================
echo        SwellDreams Backend Server
echo ========================================
echo.
echo Keep this window open while using SwellDreams.
echo The server will automatically restart if it crashes.
echo After %MAX_CRASHES% crashes in %CRASH_WINDOW% seconds, it will stop and save a crash dump.
echo.
echo Press Ctrl+C to stop the server.
echo ========================================
echo.

:: Create logs directory if it doesn't exist
if not exist "logs" mkdir logs

:loop
:: Get current time in seconds (approximate)
for /f "tokens=1-3 delims=:." %%a in ("%time%") do (
    set /a CURRENT_TIME=%%a*3600+%%b*60+%%c 2>nul
)

:: Check if we should reset crash count (outside crash window)
set /a TIME_DIFF=%CURRENT_TIME%-%LAST_CRASH_TIME% 2>nul
if %TIME_DIFF% GTR %CRASH_WINDOW% (
    set CRASH_COUNT=0
)

echo [%date% %time%] Checking dependencies...
call npm install --silent 2>nul

echo [%date% %time%] Starting backend server...
node server.js
set EXIT_CODE=%ERRORLEVEL%

:: Server stopped - check if it was a crash
if %EXIT_CODE% NEQ 0 (
    set /a CRASH_COUNT+=1
    set LAST_CRASH_TIME=%CURRENT_TIME%

    echo.
    echo [%date% %time%] Server crashed with exit code %EXIT_CODE% ^(crash %CRASH_COUNT%/%MAX_CRASHES%^)

    :: Check if we've exceeded max crashes
    if %CRASH_COUNT% GEQ %MAX_CRASHES% (
        echo.
        echo ========================================
        echo  TOO MANY CRASHES - STOPPING
        echo ========================================
        echo.
        echo Saving crash dump to logs folder...

        :: Create crash dump
        set CRASH_FILE=logs\crashdump_%date:~-4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%.txt
        set CRASH_FILE=%CRASH_FILE: =0%

        echo SwellDreams Crash Dump > "%CRASH_FILE%"
        echo ====================== >> "%CRASH_FILE%"
        echo Date: %date% %time% >> "%CRASH_FILE%"
        echo Crash Count: %CRASH_COUNT% >> "%CRASH_FILE%"
        echo Last Exit Code: %EXIT_CODE% >> "%CRASH_FILE%"
        echo. >> "%CRASH_FILE%"
        echo Node Version: >> "%CRASH_FILE%"
        node --version >> "%CRASH_FILE%" 2>&1
        echo. >> "%CRASH_FILE%"
        echo NPM Version: >> "%CRASH_FILE%"
        npm --version >> "%CRASH_FILE%" 2>&1
        echo. >> "%CRASH_FILE%"
        echo Recent npm install output: >> "%CRASH_FILE%"
        call npm install >> "%CRASH_FILE%" 2>&1
        echo. >> "%CRASH_FILE%"
        echo ====================== >> "%CRASH_FILE%"

        echo Crash dump saved. Please check logs folder.
        echo Press any key to exit...
        pause >nul
        exit /b 1
    )

    echo Restarting in 3 seconds...
    timeout /t 3 /nobreak >nul
    goto loop
) else (
    echo.
    echo [%date% %time%] Server stopped normally. Restarting in 3 seconds...
    timeout /t 3 /nobreak >nul
    goto loop
)
