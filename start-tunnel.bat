@echo off
REM drivenvibe — Cloudflare NAMED tunnel launcher (stable URL, your CF account).
REM Uses ~/.cloudflared/<TUNNEL_NAME>.yml. Defaults to 'drivenvibe' tunnel,
REM which routes drivenvibe.wminus.com → localhost:8787.
REM
REM Protection: add a Cloudflare Access Application for this hostname in the
REM Zero Trust dashboard and apply your Access policy (e.g. 'Simple geslo').

cd /d %~dp0

echo.
echo ============================================
echo   Starting drivenvibe (named Cloudflare tunnel)
echo ============================================
echo.

set TUNNEL=named
set TUNNEL_NAME=drivenvibe
call npm start

echo.
echo ============================================
echo   Server stopped. Press any key to close.
echo ============================================
pause >nul
