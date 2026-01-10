@echo off
title Stop SwellDreams

echo Stopping SwellDreams...

REM Kill windows with our specific titles
taskkill /FI "WINDOWTITLE eq SwellDreams-Backend" /F 2>nul
taskkill /FI "WINDOWTITLE eq SwellDreams-Frontend" /F 2>nul

REM Kill any node processes on our ports (backup method)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8889.*LISTENING"') do (
    echo Killing process on port 8889 (PID: %%a)
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3001.*LISTENING"') do (
    echo Killing process on port 3001 (PID: %%a)
    taskkill /F /PID %%a 2>nul
)

echo.
echo SwellDreams stopped.
timeout /t 2 >nul
