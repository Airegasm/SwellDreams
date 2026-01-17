@echo off
setlocal enabledelayedexpansion

:: SwellDreams Update Script for Windows
:: Checks for updates from the git repository

set REPO_URL=https://github.com/saintorphan/SwellDreams.git

echo ========================================
echo   SwellDreams Update Script
echo ========================================
echo.

:: Check if git is installed
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Git is not installed.
    echo.
    echo Attempting to install Git via winget...

    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        winget install --id Git.Git -e --source winget
        if %errorlevel% equ 0 (
            echo.
            echo [OK] Git installed successfully!
            echo [!] Please restart this script in a new terminal.
            pause
            exit /b 0
        ) else (
            echo [!] Failed to install Git via winget.
        )
    )

    :: Try chocolatey if winget failed
    where choco >nul 2>nul
    if %errorlevel% equ 0 (
        echo Attempting to install Git via Chocolatey...
        choco install git -y
        if %errorlevel% equ 0 (
            echo.
            echo [OK] Git installed successfully!
            echo [!] Please restart this script in a new terminal.
            pause
            exit /b 0
        )
    )

    echo.
    echo [!] Could not auto-install Git.
    echo     Please install Git manually from: https://git-scm.com/download/win
    echo     Then run this script again.
    pause
    exit /b 1
)

:: Change to script directory
cd /d "%~dp0"

:: Check if this is a git repository
if not exist ".git" (
    echo [!] This directory is not a git repository.
    echo     Initializing and connecting to remote...
    git init
    git remote add origin %REPO_URL% 2>nul || git remote set-url origin %REPO_URL%
    git fetch origin
    git checkout -b master origin/master 2>nul || git reset --hard origin/master
    echo.
    echo [OK] Repository initialized!
    goto :done
)

echo [*] Checking for updates...
echo.

:: Fetch latest changes
git fetch origin

:: Get current and remote commit hashes
for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set LOCAL=%%i
for /f "tokens=*" %%i in ('git rev-parse origin/master 2^>nul') do set REMOTE=%%i

if "!LOCAL!"=="!REMOTE!" (
    echo [OK] You are already on the latest version!
    echo     Commit: !LOCAL:~0,8!
    goto :done
)

echo [*] Updates available!
echo     Local:  !LOCAL:~0,8!
echo     Remote: !REMOTE:~0,8!
echo.

:: Show what's new
echo Changes:
git log --oneline HEAD..origin/master 2>nul
echo.

set /p CONFIRM="Do you want to update? (y/n): "
if /i not "!CONFIRM!"=="y" (
    echo Update cancelled.
    goto :done
)

echo.
echo [*] Updating...

:: Check for local changes
git diff --quiet 2>nul
if %errorlevel% neq 0 (
    echo [*] Stashing local changes...
    git stash
    set STASHED=1
)

:: Pull updates (master branch)
git pull origin master

:: Restore stashed changes if any
if "!STASHED!"=="1" (
    echo [*] Restoring local changes...
    git stash pop
)

echo.
echo [OK] Update complete!

:: Check if package.json changed
git diff HEAD@{1} --name-only 2>nul | findstr "package.json" >nul
if %errorlevel% equ 0 (
    echo.
    echo [!] package.json was updated.
    set /p INSTALLDEPS="Do you want to reinstall dependencies? (y/n): "
    if /i "!INSTALLDEPS!"=="y" (
        if exist "backend\package.json" (
            echo [*] Installing backend dependencies...
            cd backend
            call npm install
            cd ..
        )
        if exist "frontend\package.json" (
            echo [*] Installing frontend dependencies...
            cd frontend
            call npm install
            cd ..
        )
        echo [OK] Dependencies updated!
    )
)

:done
echo.
echo ========================================
echo   Done!
echo ========================================
pause
