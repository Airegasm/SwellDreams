@echo off
title Stop SwellDreams

echo Stopping SwellDreams...

REM Kill windows with our specific titles (using wildcard match)
taskkill /FI "WINDOWTITLE eq SwellDreams-Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SwellDreams-Frontend*" /F >nul 2>&1

REM Kill any node processes on port 8889 (backend)
echo Checking port 8889...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8889 "') do (
    if not "%%a"=="" (
        echo Killing backend process (PID: %%a)
        taskkill /F /PID %%a >nul 2>&1
    )
)

REM Kill any node processes on port 3001 (frontend)
echo Checking port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3001 "') do (
    if not "%%a"=="" (
        echo Killing frontend process (PID: %%a)
        taskkill /F /PID %%a >nul 2>&1
    )
)

REM Also try killing serve.exe specifically (frontend production server)
taskkill /IM serve.exe /F >nul 2>&1

echo.
echo SwellDreams stopped.
timeout /t 2 >nul
