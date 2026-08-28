# ============================================================
#  捞鱼打标工具 · 启动器（PowerShell）
#  这个窗口 = 工具的发动机。开着它，工具才能自动同步剪映音乐。
# ============================================================
$ErrorActionPreference = "Continue"
$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $toolDir
$Host.UI.RawUI.WindowTitle = "捞鱼打标工具（发动机运转中）- 想关工具就点右上角 X"

function Say($text, $color = "Gray")    { Write-Host "  $text" -ForegroundColor $color }
function Head($text)                    { Write-Host ""; Write-Host "  $text" -ForegroundColor Yellow }
function Line()                          { Say "============================================" DarkGray }

# 从网上下载的压缩包解压后，Windows 有时会拦住里面的文件（闪退/提示不安全）。
# 顺手解除拦截，只处理本文件夹顶层，很快：
try { Get-ChildItem -Path $toolDir -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue } catch {}

Line
Say "捞鱼打标工具 · 启动器" White
Say "正在准备，请稍等几秒..."
Line

# ── 第一步：找发动机（Node.js）──────────────────────────────
$nodeExe = $null
try { $nodeExe = (Get-Command node -ErrorAction Stop).Source } catch {}

if (-not $nodeExe) {
  Head "[第一次使用] 这台电脑还缺一个零件：Node.js（工具的发动机）"
  Say "不用去网上找、不用懂技术——我现在就帮你一键装好，大约 2 分钟。"
  Say "过程中如果弹出系统授权窗口，点「是」就行。" Cyan
  $ans = Read-Host "  现在就自动安装吗？直接回车 = 一键安装（推荐），输 N 先不装"

  if ($ans -match "^[nN]") {
    Head "好的，先不装。可以先用「手动模式」：能正常听歌打标签，"
    Say "只是音乐要手动选文件夹、数据只存在浏览器里（清浏览器缓存会丢）。"
    Say "以后想升级全自动：再双击启动器，回车装一下就行。"
    $ans2 = Read-Host "  用手动模式打开工具吗？直接回车 = 打开，输 N 退出"
    if ($ans2 -match "^[nN]") { exit 1 }
    Start-Process (Join-Path $toolDir "index.html")
    Say "已打开手动模式，5 秒后本窗口自动关闭。"
    Start-Sleep 5
    exit 0
  }

  Head "正在安装 Node.js，请耐心等待，别关这个窗口..."
  $winget = $null
  try { $winget = Get-Command winget -ErrorAction Stop } catch {}

  if ($winget) {
    Say "[方式一] 用 Windows 自带的软件库安装..."
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    Say "winget 退出码 $LASTEXITCODE" DarkGray
  } else {
    Say "[跳过方式一] 这台电脑没有 winget，直接用方式二..." DarkGray
  }

  $installed = Test-Path (Join-Path $env:ProgramFiles "nodejs\node.exe")
  if (-not $installed) { $nodeExe = $null } else { $nodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe" }

  if (-not $installed) {
    Head "[方式二] 直接下载官方安装包（约 30MB）..."
    $msi = Join-Path $env:TEMP "laoyu-node-install.msi"
    try {
      Invoke-WebRequest "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi" -OutFile $msi -UseBasicParsing
      Say "下载完成，开始安装（看到小进度条；如弹授权窗口请点「是」）..."
      $p = Start-Process msiexec -ArgumentList "/i `"$msi`" /passive /norestart" -Wait -PassThru
      Say "安装程序退出码 $($p.ExitCode)" DarkGray
      if (Test-Path (Join-Path $env:ProgramFiles "nodejs\node.exe")) {
        $nodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
        $installed = $true
      }
    } catch {
      Say "下载/安装出错了：$($_.Exception.Message)" Red
    }
  }

  if (-not $installed) {
    # winget 装的 node 有时不在默认位置，PATH 也可能没刷新，最后再全找一次
    try { $nodeExe = (Get-Command node -ErrorAction Stop).Source; $installed = $true } catch {}
  }

  if ($installed) {
    Head "[成功] Node.js 装好了！这就启动工具..."
  } else {
    Head "[没装成] 自动安装没成功（多半是网络或权限问题），别灰心："
    Say "1. 手动安装：马上自动打开 Node.js 官网（中文页），下载 LTS 版，" White
    Say "   双击一路「下一步」装完，再双击本启动器" White
    Say "2. 或者先用「手动模式」打标，功能少一点但能用"
    Start-Process "https://nodejs.org/zh-cn"
    $ans3 = Read-Host "  先用手动模式打开吗？直接回车 = 打开，输 N 退出"
    if ($ans3 -notmatch "^[nN]") {
      Start-Process (Join-Path $toolDir "index.html")
      Start-Sleep 5
    }
    exit 1
  }
}

# ── 第二步：点火 ────────────────────────────────────────────
Line
Say "发动机点火中，工具页面马上自动弹出..." White
Line
Say "[重要] 这个黑色窗口 = 工具的发动机"
Say "   - 让它开着就行，最小化没关系，别点右上角 X"
Say "   - 想关闭工具：点本窗口右上角 X"
Say "   - 页面没弹出来：等 10 秒，或打开浏览器访问 http://127.0.0.1:8431"
Say "新手入门、常见问题：页面顶部「? 帮助」按钮" Cyan
Line
Write-Host ""

& $nodeExe "sync-server.js"
$code = $LASTEXITCODE

if ($code -eq 2) {
  Head "工具已经在运行啦，这就帮你把页面打开。"
  Start-Process "http://127.0.0.1:8431/?server=http://127.0.0.1:8431"
  Start-Sleep 3
} elseif ($code -ne 0 -and $null -ne $code) {
  Head "[出错] 发动机没能启动，6 秒后本窗口关闭。"
  Say "可以把这个窗口截个图，发给捞鱼帮忙看看。" Cyan
  Start-Sleep 6
}
