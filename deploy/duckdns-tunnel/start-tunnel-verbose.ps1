# 带日志的反向隧道（方便排查）
# 用法：powershell -ExecutionPolicy Bypass -File deploy\duckdns-tunnel\start-tunnel-verbose.ps1
#
# 成功时：窗口停住、无新输出 = 正常，不要关窗口
# 失败时：看下方日志文件

$ErrorActionPreference = "Continue"
$VpsHost = "45.196.233.210"
$VpsUser = "root"
$LogDir = Join-Path $env:USERPROFILE "zhubofenxi-tunnel-logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  主播分析 · SSH 反向隧道（详细模式）" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 先确认本地服务正常："
try {
  $h = Invoke-RestMethod "http://127.0.0.1:4723/api/health" -TimeoutSec 5
  Write-Host "   本地 4723 OK: $($h | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
  Write-Host "   本地 4723 未启动！请先 npm run start:server" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "2. 即将连接 VPS 并建立隧道..."
Write-Host "   输入密码后窗口会「停住不动」——这是正常的，表示隧道已建立。"
Write-Host "   请不要关这个窗口！关掉外网立刻 502。"
Write-Host ""
Write-Host "3. 隧道建立后，另开一个窗口 SSH 登录 VPS，执行："
Write-Host "   curl -i http://127.0.0.1:14723/api/health"
Write-Host ""
Write-Host "4. 日志写入: $LogDir\tunnel-latest.log"
Write-Host ""

$logFile = Join-Path $LogDir "tunnel-latest.log"
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "`n=== $ts 开始连接 ==="

while ($true) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$ts] 正在连接..." -ForegroundColor Yellow
  Add-Content $logFile "[$ts] ssh 启动"

  # -v 输出写入日志，便于排查 remote forward 是否失败
  ssh -v -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
    -R "127.0.0.1:14723:127.0.0.1:4723" `
    "${VpsUser}@${VpsHost}" 2>&1 | Tee-Object -FilePath $logFile -Append

  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$ts] 连接断开，10 秒后重连..." -ForegroundColor Red
  Add-Content $logFile "[$ts] 断开，10s 后重连"
  Start-Sleep -Seconds 10
}
