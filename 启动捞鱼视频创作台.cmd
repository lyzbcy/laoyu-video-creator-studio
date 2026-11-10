@echo off
setlocal
set "STUDIO=%LOCALAPPDATA%\Programs\LaoyuCreatorStudio\0.1.4-dev\LaoyuCreatorStudio.exe"
if not exist "%STUDIO%" (
  echo Laoyu Creator Studio 0.1.4-dev is not installed for this Windows user.
  pause
  exit /b 1
)
start "" "%STUDIO%"
