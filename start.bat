@echo off
title SwellDreams Startup

echo SwellDreams Production Startup Script
echo.

REM Get script directory
set SCRIPT_DIR=%~dp0
echo Script directory: %SCRIPT_DIR%

REM Read version from version.json
set VERSION=3.8.0
set CODENAME=Stable Overhaul
for /f "tokens=2 delims=:," %%a in ('type "%SCRIPT_DIR%version.json" ^| findstr /c:"\"version\""') do (
    set VERSION=%%~a
)
for /f "tokens=2 delims=:," %%a in ('type "%SCRIPT_DIR%version.json" ^| findstr /c:"\"codename\""') do (
    set CODENAME=%%~a
)
REM Trim spaces
set VERSION=%VERSION: =%
set CODENAME=%CODENAME: =%

REM Stop any previous SwellDreams backend so this restart actually runs the updated code.
REM (Previously this only WARNED and continued - the new "node server.js" then failed to bind
REM the port, the OLD server kept running, and server.js fixes silently never took effect while
REM the statically-served frontend looked updated. Mirror of start.sh's hardened logic.)
REM Two nets: (1) our saved PID file, (2) whatever holds port 8889. In BOTH cases a process is
REM only killed if its command line really is a server.js node process, so unrelated node apps
REM are never touched.
echo Checking for existing SwellDreams server...
set "PID_DIR=%SCRIPT_DIR%.pids"
if not exist "%PID_DIR%" mkdir "%PID_DIR%" >nul 2>nul
if not exist "%PID_DIR%\server.pid" goto :SkipPidKill
set /p OLD_PID=<"%PID_DIR%\server.pid"
call :KillIfSwellD %OLD_PID%
:SkipPidKill
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":8889 " ^| findstr /C:"LISTENING"') do call :KillIfSwellD %%p

echo.
echo ========================================
echo   SwellDreams v%VERSION% %CODENAME%
echo ========================================
echo.

REM Auto-update from git
echo Checking for updates...
cd /d "%SCRIPT_DIR%"
REM Ensure git has an identity so no operation can fail with "tell me who you are".
git config user.email >nul 2>nul || git config user.email "swelldreams@localhost"
git config user.name >nul 2>nul || git config user.name "SwellDreams"

REM --- One-time legacy node_modules cleanup ---------------------------------------------------------
REM Builds prior to v6.6.8 TRACKED backend/node_modules and frontend/node_modules as directory
REM symlinks. On Windows, "git reset --hard" (below) loops forever failing to unlink those symlinks
REM ("unlink of 'backend/node_modules' failed"), stranding the user on the old version. If they're
REM still tracked, untrack + physically remove them here so the sync is clean; npm install recreates
REM real node_modules afterward. Gated on being tracked, so healthy (untracked) installs are left
REM alone and the normal "skip reinstall when nothing changed" fast path still works.
git ls-files --error-unmatch backend/node_modules >nul 2>nul
if not errorlevel 1 (
    echo Legacy node_modules detected - cleaning up before update...
    git rm -r --cached --quiet backend/node_modules frontend/node_modules >nul 2>nul
    if exist "backend\node_modules" rmdir "backend\node_modules" >nul 2>nul
    if exist "backend\node_modules" rmdir /s /q "backend\node_modules" >nul 2>nul
    if exist "backend\node_modules" del /f /q "backend\node_modules" >nul 2>nul
    if exist "frontend\node_modules" rmdir "frontend\node_modules" >nul 2>nul
    if exist "frontend\node_modules" rmdir /s /q "frontend\node_modules" >nul 2>nul
    if exist "frontend\node_modules" del /f /q "frontend\node_modules" >nul 2>nul
)
REM -------------------------------------------------------------------------------------------------

REM Snapshot the commit before syncing, so we can skip the slow reinstall+rebuild when nothing changed.
set "BEFORE_HEAD=none"
for /f "tokens=*" %%h in ('git rev-parse HEAD 2^>nul') do set "BEFORE_HEAD=%%h"
if not exist ".git" (
    echo Git repository not found. Setting up...
    git init
    git config user.email "swelldreams@localhost"
    git config user.name "SwellDreams"
    git remote add origin https://github.com/Airegasm/SwellDreams.git
    git fetch origin release
    git checkout -b release origin/release
    echo Repository initialized on release branch.
) else (
    git remote get-url origin >nul 2>nul
    if errorlevel 1 (
        echo No remote configured. Adding origin...
        git remote add origin https://github.com/Airegasm/SwellDreams.git
        git pull origin release
        echo Remote added. Pulled from release branch.
    ) else (
        REM Migrate master users to release branch
        for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set CURRENT_BRANCH=%%b
        if "%CURRENT_BRANCH%"=="master" (
            echo Migrating from master to release branch...
            git fetch origin release >nul 2>nul
            git checkout -f release >nul 2>nul
            if not errorlevel 1 (
                git branch -D master >nul 2>nul
                echo Switched to release branch.
            ) else (
                echo Warning: Could not switch to release. Continuing on master...
            )
        )
        if "%CURRENT_BRANCH%"=="main" (
            echo Migrating from main to release branch...
            git fetch origin release >nul 2>nul
            git checkout -f release >nul 2>nul
            if not errorlevel 1 (
                git branch -D main >nul 2>nul
                echo Switched to release branch.
            ) else (
                echo Warning: Could not switch to release. Continuing on main...
            )
        )
        REM Force-sync to release. The launcher rebuilds the frontend every run, which dirties
        REM tracked build files and used to make "git pull" fail (stranding users on old versions).
        REM reset --hard only touches TRACKED files (code/defaults); all user data is gitignored.
        git fetch origin release
        if errorlevel 1 (
            echo Warning: Could not reach git. Continuing with local version...
        ) else (
            git reset --hard origin/release
            echo Update complete!
        )
    )
)
REM Did the sync change the code? If HEAD is unchanged (and not a fresh checkout), skip reinstall+rebuild.
set "AFTER_HEAD=none"
for /f "tokens=*" %%h in ('git rev-parse HEAD 2^>nul') do set "AFTER_HEAD=%%h"
set "SOURCE_CHANGED=1"
if "%BEFORE_HEAD%"=="%AFTER_HEAD%" if not "%BEFORE_HEAD%"=="none" set "SOURCE_CHANGED=0"
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
    echo Warning: Python not found. Some features ^(Tapo^) will be unavailable.
    echo Install Python from https://www.python.org/downloads/
) else (
    python --version
    echo Installing/updating Python dependencies ^(Tapo^)...
    python -m pip install --upgrade pip >nul 2>nul
    python -m pip install -r "%SCRIPT_DIR%backend\requirements.txt"
    if errorlevel 1 (
        echo Warning: Some Python dependencies failed to install. Some features may be limited.
    ) else (
        echo Python dependencies installed successfully!
    )
)

REM Install/update backend dependencies - only when the code changed or deps are missing.
echo.
cd /d "%SCRIPT_DIR%backend"
if not exist "package.json" (
    echo ERROR: backend/package.json not found!
    pause
    exit /b 1
)
set "NEED_BE=0"
if "%SOURCE_CHANGED%"=="1" set "NEED_BE=1"
if not exist "node_modules" set "NEED_BE=1"
if not exist "node_modules\express" set "NEED_BE=1"
if "%NEED_BE%"=="1" (
    echo Installing backend dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: Backend npm install failed!
        pause
        exit /b 1
    )
) else (
    echo Backend dependencies up to date ^(no update^) - skipping.
)

REM Install/update frontend dependencies - only when the code changed or deps are missing.
echo.
cd /d "%SCRIPT_DIR%frontend"
if not exist "package.json" (
    echo ERROR: frontend/package.json not found!
    pause
    exit /b 1
)
set "NEED_FE=0"
if "%SOURCE_CHANGED%"=="1" set "NEED_FE=1"
if not exist "node_modules" set "NEED_FE=1"
if not exist "node_modules\react-scripts" set "NEED_FE=1"
if not exist "node_modules\.bin\react-scripts.cmd" set "NEED_FE=1"
if "%NEED_FE%"=="1" (
    echo Installing frontend dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: Frontend npm install failed!
        pause
        exit /b 1
    )
) else (
    echo Frontend dependencies up to date ^(no update^) - skipping.
)

REM Rebuild the frontend - only when the code changed or a build is missing. A plain restart with no
REM update reuses the existing build\ instead of recompiling (the slow part of startup).
echo.
set "NEED_BUILD=0"
if "%SOURCE_CHANGED%"=="1" set "NEED_BUILD=1"
if not exist "build\index.html" set "NEED_BUILD=1"
if "%NEED_BUILD%"=="1" (
    echo Building frontend for production...
    if exist "build" rmdir /s /q "build"
    call npm run build
    if errorlevel 1 (
        echo ERROR: Frontend build failed!
        pause
        exit /b 1
    )
) else (
    echo Frontend build up to date ^(no update^) - skipping rebuild.
)

REM Start server in new window
echo.
echo Starting SwellDreams server...
start "SwellDreams Server" cmd /k "cd /d %SCRIPT_DIR%backend && node server.js"

REM Wait for the server to bind, then save its PID (the process LISTENING on :8889 is node
REM itself) so the next start.bat run can stop it cleanly.
set "NEW_PID="
for /l %%i in (1,1,10) do (
    if not defined NEW_PID (
        for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":8889 " ^| findstr /C:"LISTENING"') do set "NEW_PID=%%p"
        if not defined NEW_PID timeout /t 1 /nobreak >nul
    )
)
if defined NEW_PID (
    echo %NEW_PID%>"%PID_DIR%\server.pid"
) else (
    echo Warning: server not confirmed listening on port 8889 yet - check the server window.
)

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
exit /b 0

REM ---- Subroutine: kill PID %1 only if it is really a SwellDreams server.js node process ----
:KillIfSwellD
if "%~1"=="" goto :eof
powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%~1' -ErrorAction SilentlyContinue; if($p -and $p.CommandLine -match 'server\.js'){exit 0}else{exit 1}" >nul 2>nul
if errorlevel 1 goto :eof
echo Stopping previous SwellDreams server (PID %~1)...
taskkill /PID %~1 >nul 2>nul
timeout /t 1 /nobreak >nul
taskkill /F /PID %~1 >nul 2>nul
goto :eof
