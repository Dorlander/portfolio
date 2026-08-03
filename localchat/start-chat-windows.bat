@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install LTS (^>=18) from https://nodejs.org and run again.
  pause
  exit /b 1
)

if not exist "server\data" mkdir "server\data"

set "SECRET_FILE=server\data\.jwt-secret"
if not exist "%SECRET_FILE%" (
  for /f "delims=" %%s in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set "JWT_SECRET=%%s"
  > "%SECRET_FILE%" echo %JWT_SECRET%
) else (
  set /p JWT_SECRET=<"%SECRET_FILE%"
)
set "NODE_ENV=production"
set "CORS_ORIGINS=http://localhost:3780"
set "HOST=0.0.0.0"

if not exist "client\node_modules" (
  echo Installing client dependencies - first run only...
  pushd client & call npm install & popd
  if errorlevel 1 ( echo [ERROR] npm install client failed & pause & exit /b 1 )
)
if not exist "client\dist" (
  echo Building client - first run only, takes a few minutes...
  pushd client & call npm run build & popd
  if errorlevel 1 ( echo [ERROR] client build failed & pause & exit /b 1 )
)
if not exist "server\node_modules" (
  echo Installing server dependencies - first run only...
  pushd server & call npm install & popd
  if errorlevel 1 ( echo [ERROR] npm install server failed - better-sqlite3/sharp may need Visual Studio Build Tools & pause & exit /b 1 )
)

echo.
echo   Chat: http://localhost:3780
echo   From other PCs: http://YOUR-IP:3780   (Ctrl+C to stop)
echo.
node server\src\index.js
pause
