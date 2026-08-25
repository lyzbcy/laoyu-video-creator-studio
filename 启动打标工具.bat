@echo off
title Laoyu Tagger (running) - close this window to STOP
cd /d "%~dp0"
set "NODE_CMD=node"
where node >nul 2>&1
if errorlevel 1 goto :NO_NODE
goto :RUN

:NO_NODE
echo.
echo  [MISSING] Node.js not found on this computer.
where winget >nul 2>&1
if errorlevel 1 goto :MANUAL
choice /c YN /n /m "Auto-install Node.js LTS via winget? about 2 min, may pop UAC [Y/N]: "
if errorlevel 2 goto :DECLINE
echo.
echo  Installing Node.js LTS silently... please wait, do not close this window.
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
  echo  [OK] Node.js installed. Starting the tool...
  goto :RUN
)
where node >nul 2>&1
if not errorlevel 1 goto :RUN
echo  [WARN] Install finished but node still not found.
goto :MANUAL

:DECLINE
echo.
echo  You declined auto-install.
choice /c YN /n /m "Open tool in browser-only mode instead? no auto-sync [Y/N]: "
if errorlevel 2 exit /b 1
start "" "%~dp0index.html"
echo  Browser-only mode opened. Closing in 5s.
ping -n 6 127.0.0.1 >nul
exit /b 0

:MANUAL
echo.
echo  Cannot auto-install on this system. Two options:
echo   1^) Manual install: https://nodejs.org/  LTS, next-next-finish ^(browser opening^)
echo   2^) Or try browser-only mode now ^(no auto-sync, pick cache folder manually^)
start "" "https://nodejs.org/"
choice /c YN /n /m "Open tool in browser-only mode now [Y/N]: "
if errorlevel 2 exit /b 1
start "" "%~dp0index.html"
echo  Browser-only mode opened. Closing in 5s.
ping -n 6 127.0.0.1 >nul
exit /b 0

:RUN
echo ============================================
echo   Laoyu Tagger starting...
echo   [x] button on this window = stop tool
echo   See "START-HERE.txt" for Chinese guide.
echo ============================================
"%NODE_CMD%" sync-server.js
if errorlevel 2 (
  echo.
  echo [TIP] Already running - opening the page for you.
  ping -n 4 127.0.0.1 >nul
) else if errorlevel 1 (
  echo.
  echo [ERROR] Server failed to start. Closing in 6s.
  ping -n 7 127.0.0.1 >nul
)
