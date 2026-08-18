@echo off
title Laoyu Tagger (running) - close this window to STOP
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [MISSING] Node.js not found. Install LTS from https://nodejs.org
  echo  then double-click this file again.
  echo  ^(Browser opening for you...^)
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
echo ============================================
echo   Laoyu Tagger starting...
echo   [x] button on this window = stop tool
echo   See "START-HERE.txt" for Chinese guide.
echo ============================================
node sync-server.js
if errorlevel 2 (
  echo.
  echo [TIP] Already running - opening the page for you.
  ping -n 4 127.0.0.1 >nul
) else if errorlevel 1 (
  echo.
  echo [ERROR] Server failed to start. Closing in 6s.
  ping -n 7 127.0.0.1 >nul
)
