# 捞鱼打标工具 · 一键停止（按端口揪出服务器进程，孤儿进程也能杀）
$found = $false
$lines = netstat -ano | Select-String ":8431\s.*LISTENING"
foreach ($ln in $lines) {
  $parts = ($ln.ToString() -split '\s+')
  $pid = [int]$parts[-1]
  try { Stop-Process -Id $pid -Force -ErrorAction Stop; $found = $true } catch {}
}
Write-Host ""
if ($found) {
  Write-Host "  工具已停止，3 秒后本窗口自动关闭。" -ForegroundColor Green
} else {
  Write-Host "  没发现正在运行的工具（端口 8431 空闲）。3 秒后自动关闭。" -ForegroundColor Gray
}
Start-Sleep 3
