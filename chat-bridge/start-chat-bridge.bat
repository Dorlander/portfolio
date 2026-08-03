@echo off
rem Chat bridge: uchet UTK -> LocalChat. ASCII only in this file!
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 20+ first.
  pause
  exit /b 1
)
if not exist .env (
  echo File .env not found. Copy .env.example to .env and fill it.
  pause
  exit /b 1
)
if "%1"=="test" (
  node bridge.mjs --test
  pause
  exit /b 0
)
node bridge.mjs
pause
