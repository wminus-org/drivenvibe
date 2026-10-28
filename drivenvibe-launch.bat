@echo off
title Drive ^& Vibe
cd /d "%~dp0"

echo.
echo  ============================================
echo    Drive ^& Vibe  -  starting server + tunnel
echo  ============================================
echo.

REM Free port 8787 if a previous run is still holding it.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787" ^| findstr LISTENING') do (
  echo  Freeing port 8787 (pid %%a)...
  taskkill /f /pid %%a >nul 2>&1
)

REM Named Cloudflare tunnel -> stable URL https://drivenvibe.wminus.com
set TUNNEL=named
set TUNNEL_NAME=drivenvibe
call npm start

echo.
echo  ============================================
echo    Server stopped. Press any key to close.
echo  ============================================
pause >nul
