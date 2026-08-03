@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Режим разработки: сервер (:3780) и клиент Vite (:5173) запускаются ОТДЕЛЬНО,
REM в двух окнах. Открывайте http://localhost:5173 (Vite проксирует /api и
REM WebSocket на сервер). Для эксплуатации используйте start-chat-windows.bat
REM (там клиент собирается и отдаётся сервером на одном порту 3780).

where node >nul 2>nul
if errorlevel 1 ( echo [ERROR] Node.js not found. https://nodejs.org & pause & exit /b 1 )

if not exist "server\node_modules" ( pushd server & call npm install & popd )
if not exist "client\node_modules" ( pushd client & call npm install & popd )

echo Starting server (:3780) in a new window...
start "LocalChat server" cmd /c "cd /d "%~dp0server" && node --watch src/index.js"

echo Starting client Vite (:5173) in a new window...
start "LocalChat client" cmd /c "cd /d "%~dp0client" && npm run dev -- --host 0.0.0.0"

echo.
echo   Открывайте http://localhost:5173  (dev, с автоперезагрузкой)
echo   Сервер API: http://localhost:3780
echo.
pause
