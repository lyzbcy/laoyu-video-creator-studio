@echo off
chcp 65001 >nul
title 捞鱼打标工具 - 停止
set PORT=8431
set KILLED=
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  taskkill /f /pid %%a >nul 2>&1 && set KILLED=1
)
if defined KILLED (
  echo 已停止捞鱼打标工具的服务器。
) else (
  echo 没有在运行的服务器（端口 %PORT% 无占用），本来就关着。
)
echo 窗口 3 秒后自动关闭。
ping -n 4 127.0.0.1 >nul
