@echo off
title Stop SwellDreams

echo Stopping SwellDreams...

REM Kill window with our specific title
taskkill /FI "WINDOWTITLE eq SwellDreams*" /F >nul 2>&1

REM Kill any node processes on port 8889
echo Checking port 8889...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8889 "') do (
    if not "%%a"=="" (
        echo Killing server process (PID: %%a)
        taskkill /F /PID %%a >nul 2>&1
    )
)

echo.
echo SwellDreams stopped.
timeout /t 2 >nul
