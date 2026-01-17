@echo off
echo SwellDreams Manual Update
echo ========================
cd /d "%~dp0"
git -c user.email="update@swelldreams.local" -c user.name="SwellDreams" pull origin master
if %errorlevel% neq 0 (
    echo.
    echo Update failed. Try downloading fresh from GitHub:
    echo https://github.com/Airegasm/SwellDreams/archive/refs/heads/master.zip
    pause
    exit /b 1
)
echo.
echo Update complete! Please restart the application.
pause
