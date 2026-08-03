@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install LTS (^>=18) from https://nodejs.org and run again.
  pause
  exit /b 1
)

echo Starting LocalChat (port 3780) in a new window...
start "LocalChat" cmd /c "cd /d "%~dp0localchat" && call start-chat-windows.bat"

echo Starting Uchet UTK (port 3000) in a new window...
start "Uchet UTK" cmd /c "cd /d "%~dp0acts" && call start-windows.bat"

echo.
echo   Chat:  http://localhost:3780
echo   Uchet: http://localhost:3000
echo.
echo Both started in separate windows. Close them to stop.
pause
