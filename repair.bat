@echo off
title SwellDreams Repair
cd /d "%~dp0"

echo ========================================
echo   SwellDreams One-Time Repair
echo ========================================
echo.
echo This fixes stuck updates: the "can't update past v6.0" / "tell me who you are"
echo problem AND the "unlink of backend/node_modules failed" loop when upgrading
echo from v6.6.7 or earlier on Windows.
echo Your settings, characters, and personas are NOT touched.
echo.
echo Close the "SwellDreams Server" window first if it is open, then press a key.
pause >nul

if not exist ".git" (
    echo ERROR: This folder is not a git checkout, so it cannot self-repair.
    echo Please re-download SwellDreams fresh from GitHub, then copy your old
    echo backend\data folder into the new install.
    echo.
    pause
    exit /b 1
)

REM Give git an identity so nothing fails with "tell me who you are".
git config user.email "swelldreams@localhost"
git config user.name "SwellDreams"

REM Untrack the build folder + personal libraries FIRST so the hard reset preserves them
REM (they used to be committed by mistake; this keeps your games/profiles/triggers).
git rm --cached -r frontend/build >nul 2>nul
git rm --cached backend/data/minigames.json backend/data/checkpoint-profiles.json backend/data/persona-checkpoint-profiles.json backend/data/trigger-sets.json >nul 2>nul

REM Fix the pre-6.6.8 node_modules symlinks ONLY if they're still tracked (the broken legacy state).
REM On Windows "git reset --hard" (below) loops forever unlinking these ("unlink of
REM 'backend/node_modules' failed"). Untrack + delete the on-disk entry; start.bat's npm install
REM recreates real node_modules. A healthy (untracked) install is left alone, so running repair when
REM this particular problem does NOT exist won't force a needless full dependency reinstall.
git ls-files --error-unmatch backend/node_modules >nul 2>nul
if not errorlevel 1 (
    echo Removing legacy node_modules links...
    git rm -r --cached backend/node_modules frontend/node_modules >nul 2>nul
    if exist "backend\node_modules" rmdir "backend\node_modules" >nul 2>nul
    if exist "backend\node_modules" rmdir /s /q "backend\node_modules" >nul 2>nul
    if exist "backend\node_modules" del /f /q "backend\node_modules" >nul 2>nul
    if exist "frontend\node_modules" rmdir "frontend\node_modules" >nul 2>nul
    if exist "frontend\node_modules" rmdir /s /q "frontend\node_modules" >nul 2>nul
    if exist "frontend\node_modules" del /f /q "frontend\node_modules" >nul 2>nul
)

echo Fetching the latest release...
git fetch origin release
if errorlevel 1 (
    echo ERROR: Could not reach GitHub. Check your internet connection and try again.
    pause
    exit /b 1
)

echo Force-syncing to the latest version...
git reset --hard origin/release

echo.
echo ========================================
echo   Repair complete! Launching SwellDreams...
echo ========================================
echo.
call start.bat
