@echo off
REM drivenvibe — one-click launcher for Windows.
REM Double-click this file to start the server.

cd /d %~dp0

echo.
echo ============================================
echo   Starting drivenvibe...
echo ============================================
echo.

call npm start

echo.
echo ============================================
echo   Server stopped. Press any key to close.
echo ============================================
pause >nul
