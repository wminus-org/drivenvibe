@echo off
REM drivenvibe — open inbound port 8787 on the ZeroTier interface only.
REM Safe: does NOT expose the port on Wi-Fi, Ethernet, or public networks.
REM Idempotent: re-run anytime; replaces existing rule.

REM ---- self-elevate to admin ----
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting admin privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

setlocal enabledelayedexpansion

echo.
echo === drivenvibe firewall setup ===
echo.

REM ---- find ZeroTier adapter ----
echo Looking for ZeroTier adapter...
set "ZTNAME="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetAdapter ^| Where-Object { $_.InterfaceDescription -match 'ZeroTier' } ^| Select-Object -First 1).Name"`) do set "ZTNAME=%%i"

if "!ZTNAME!"=="" (
    echo.
    echo ERROR: No ZeroTier adapter found.
    echo Make sure ZeroTier One is installed and your network is joined.
    echo.
    pause
    exit /b 1
)

echo Found: !ZTNAME!

REM ---- remove existing rule and add fresh one scoped to ZeroTier interface ----
echo Adding firewall rule for port 8787 on ZeroTier only...
powershell -NoProfile -Command "Remove-NetFirewallRule -DisplayName 'drivenvibe' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'drivenvibe' -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -InterfaceAlias '!ZTNAME!' | Out-Null"

if %errorLevel% neq 0 (
    echo.
    echo ERROR: failed to add firewall rule.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Done. Your phone can now reach drivenvibe over ZeroTier.
echo.
echo   To remove later:
echo     powershell admin: Remove-NetFirewallRule -DisplayName 'drivenvibe'
echo ============================================================
echo.
pause
