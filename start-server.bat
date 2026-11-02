@echo off
chcp 65001 >nul
rem ============================================================
rem  Run the Emergency Dashboard on THIS computer so other computers on the
rem  same network can open it. Nothing to install except Node.js.
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org ^(LTS^) and run this file again.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=8080
if "%STORAGE_DIR%"=="" set STORAGE_DIR=%~dp0storage

echo.
echo  Emergency Dashboard server starting...
echo  Open from THIS computer:        http://localhost:%PORT%/emergency
echo  Open from OTHER computers on the same network:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "ip=%%a"
  set "ip=!ip: =!"
  echo        http://!ip!:%PORT%/emergency
)
echo.
echo  First run: the one-time admin password is printed below ^(user: admin^).
echo  Forgot it?  Close this window and run:  node server.mjs --reset-admin
echo  If Windows asks about the firewall, choose "Allow access".
echo  Keep this window open while people are using the system.
echo.
node server.mjs
pause
