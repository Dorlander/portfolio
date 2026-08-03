@echo off
rem Load fictional demo data. WARNING: this ERASES the database. ASCII only.
cd /d "%~dp0"
echo.
echo WARNING: this will ERASE all data and load fictional demo data.
choice /m "Continue"
if errorlevel 2 goto :cancel
node scripts\seed-demo.mjs --yes
pause
exit /b 0
:cancel
echo Cancelled.
pause
