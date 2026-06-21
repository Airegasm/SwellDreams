@echo off
title SwellDreams Repair
cd /d "%~dp0"

echo ========================================
echo   SwellDreams One-Time Repair
echo ========================================
echo.
echo This fixes the "can't update past v6.0" / "tell me who you are" problem.
echo Your settings, characters, and personas are NOT touched.
echo.

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
