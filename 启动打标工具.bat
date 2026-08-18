@echo off
chcp 65001 >nul
title 捞鱼打标工具（运行中）- 关掉本窗口即停止
cd /d "%~dp0"
rem ── 环境检查：没装 Node.js 就友好提示，不甩报错 ──
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [缺环境] 没有检测到 Node.js，工具跑不起来。
  echo  解决办法：打开 https://nodejs.org 下载 LTS 版安装（一路下一步），
  echo  装完再回来双击本文件。
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
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
  ping -n 5 127.0.0.1 >nul
) else if errorlevel 1 (
  echo.
  echo [出错] 服务器启动失败，窗口 6 秒后自动关闭。
  ping -n 7 127.0.0.1 >nul
)
