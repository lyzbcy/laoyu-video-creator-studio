@echo off
title Laoyu Tagger - STOP
set PORT=8431
set KILLED=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  taskkill /f /pid %%a >nul 2>&1 && set KILLED=1
)
if defined KILLED (
  echo Server stopped. Closing in 3s.
) else (
  echo No running server found ^(port %PORT% free^).
  ping -n 4 127.0.0.1 >nul
)
