# 主播分析 · 本地到 VPS 反向 SSH 隧道（常驻重连）
# 用法：在 PowerShell 中执行
#   powershell -ExecutionPolicy Bypass -File .\deploy\duckdns-tunnel\start-tunnel.ps1
#
# 注意：
# - 不要把密码写进本脚本
# - 首次连接需手动输入密码，或先在 VPS 配置 SSH 公钥免密
# - 保持本窗口运行，隧道才有效

$ErrorActionPreference = "Continue"

$VpsHost = "45.196.233.210"
$VpsUser = "root"
$RemoteBind = "127.0.0.1:14723"
$LocalTarget = "127.0.0.1:4723"

while ($true) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "$ts 启动主播分析外网隧道 ($RemoteBind -> $LocalTarget) ..."
  ssh -N -R "${RemoteBind}:${LocalTarget}" "${VpsUser}@${VpsHost}"
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "$ts 隧道断开，10 秒后重连..."
  Start-Sleep -Seconds 10
}
