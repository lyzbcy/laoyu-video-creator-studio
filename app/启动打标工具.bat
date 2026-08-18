@echo off
title 捞鱼打标工具（运行中）- 关掉本窗口即停止
cd /d "%~dp0"
echo ============================================
echo   捞鱼打标工具启动中...
echo   关掉本黑窗口 = 停止工具（浏览器页面可随意开合）
echo   想彻底停止也可双击本目录的「停止打标工具.bat」
echo ============================================
node sync-server.js
if errorlevel 2 (
  echo.
  echo [提示] 工具已经在运行啦，浏览器里直接用就行。
  echo 窗口 4 秒后自动关闭。
  timeout /t 4 >nul
) else if errorlevel 1 (
  echo.
  echo [出错] 服务器启动失败，窗口 6 秒后自动关闭。
  timeout /t 6 >nul
)
