#Requires -Version 5.1
<#
  一键配置：SSH 免密 + 反向隧道 + 开机自启
  用法: powershell -ExecutionPolicy Bypass -File deploy\duckdns-tunnel\setup-all.ps1
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$KeyPath = Join-Path $env:USERPROFILE ".ssh\zhubofenxi_tunnel_ed25519"
$PubPath = "$KeyPath.pub"
$SshConfig = Join-Path $env:USERPROFILE ".ssh\config"
$HostAlias = "zhubofenxi-vps"
$TaskName = "ZhubofenxiTunnel"
$LogDir = Join-Path $env:USERPROFILE "zhubofenxi-tunnel-logs"
$TunnelScript = Join-Path $PSScriptRoot "run-tunnel.ps1"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

Write-Host "========================================" -ForegroundColor Green
Write-Host "  主播分析外网隧道 · 一键配置" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Write-Step "检查本地服务 4723"
try {
  $h = Invoke-RestMethod "http://127.0.0.1:4723/api/health" -TimeoutSec 5
  Write-Host "   OK: $($h.service)" -ForegroundColor Green
} catch {
  Write-Host "   本地服务未启动，正在启动..." -ForegroundColor Yellow
  Set-Location $Root
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root'; npm run start:server" -WindowStyle Minimized
  Start-Sleep -Seconds 8
  $h = Invoke-RestMethod "http://127.0.0.1:4723/api/health" -TimeoutSec 10
  Write-Host "   OK: $($h.service)" -ForegroundColor Green
}

Write-Step "检查 SSH 密钥"
if (-not (Test-Path $KeyPath)) {
  ssh-keygen -t ed25519 -f $KeyPath -N '""' -C "zhubofenxi-tunnel" | Out-Null
}
Write-Host "   公钥: $PubPath" -ForegroundColor Gray

Write-Step "写入 SSH config"
New-Item -ItemType Directory -Force -Path (Split-Path $SshConfig) | Out-Null
$marker = "# zhubofenxi-tunnel"
$configText = Get-Content $SshConfig -Raw -ErrorAction SilentlyContinue
if ($configText -notmatch [regex]::Escape($marker)) {
  @"

$marker
Host $HostAlias
    HostName 45.196.233.210
    User root
    IdentityFile ~/.ssh/zhubofenxi_tunnel_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
    StrictHostKeyChecking accept-new
"@ | Add-Content -Path $SshConfig -Encoding utf8
  Write-Host "   已追加到 $SshConfig" -ForegroundColor Green
} else {
  Write-Host "   已存在，跳过" -ForegroundColor Gray
}

Write-Step "测试免密登录"
$canLogin = $false
try {
  $out = ssh -o BatchMode=yes -o ConnectTimeout=8 $HostAlias "echo OK" 2>&1
  if ($LASTEXITCODE -eq 0 -and $out -match "OK") { $canLogin = $true }
} catch { }

if (-not $canLogin) {
  Write-Host ""
  Write-Host "   需要把公钥安装到 VPS（只需输入一次 root 密码）" -ForegroundColor Yellow
  Write-Host "   即将弹出新窗口，请输入 VPS 密码后等待「公钥已安装」提示" -ForegroundColor Yellow
  Write-Host ""

  $installCmd = @"
Write-Host '正在安装公钥到 VPS，请输入 root 密码...' -ForegroundColor Cyan
`$pub = Get-Content '$PubPath' -Raw
ssh root@45.196.233.210 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF `"`$(echo `$pub | tr -d '\r\n')`" ~/.ssh/authorized_keys 2>/dev/null || echo `"`$(echo `$pub | tr -d '\r\n')`" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 公钥已安装"
Write-Host ''
Write-Host '完成！可以关闭此窗口。' -ForegroundColor Green
Read-Host '按 Enter 关闭'
"@
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $installCmd

  Write-Host "   等待你在弹出窗口完成密码输入..." -ForegroundColor Yellow
  for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    try {
      $out = ssh -o BatchMode=yes -o ConnectTimeout=8 $HostAlias "echo OK" 2>&1
      if ($LASTEXITCODE -eq 0 -and $out -match "OK") {
        $canLogin = $true
        Write-Host "   免密登录成功！" -ForegroundColor Green
        break
      }
    } catch { }
    Write-Host "   等待中... ($($i + 1)/36)" -ForegroundColor Gray
  }
}

if (-not $canLogin) {
  Write-Host ""
  Write-Host "免密登录仍未成功。请在新窗口完成公钥安装后，重新运行:" -ForegroundColor Red
  Write-Host "  powershell -ExecutionPolicy Bypass -File deploy\duckdns-tunnel\setup-all.ps1" -ForegroundColor White
  exit 1
}

Write-Step "VPS 端检查并修复 sshd 转发（如需要）"
ssh $HostAlias @'
set -e
CHANGED=0
if ! grep -q "^AllowTcpForwarding yes" /etc/ssh/sshd_config 2>/dev/null; then
  cp -a /etc/ssh/sshd_config /root/backup-sshd_config-$(date +%Y%m%d%H%M%S) 2>/dev/null || true
  if grep -q "^AllowTcpForwarding" /etc/ssh/sshd_config; then
    sed -i "s/^AllowTcpForwarding.*/AllowTcpForwarding yes/" /etc/ssh/sshd_config
  else
    echo "AllowTcpForwarding yes" >> /etc/ssh/sshd_config
  fi
  CHANGED=1
fi
if ! grep -q "^GatewayPorts clientspecified" /etc/ssh/sshd_config 2>/dev/null; then
  if grep -q "^GatewayPorts" /etc/ssh/sshd_config; then
    sed -i "s/^GatewayPorts.*/GatewayPorts clientspecified/" /etc/ssh/sshd_config
  else
    echo "GatewayPorts clientspecified" >> /etc/ssh/sshd_config
  fi
  CHANGED=1
fi
if [ "$CHANGED" = "1" ]; then
  systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || service ssh reload 2>/dev/null || true
  echo "sshd 已更新"
else
  echo "sshd 已允许转发"
fi
'@

Write-Step "VPS 端检查 Nginx 18080"
ssh $HostAlias @'
if [ ! -f /etc/nginx/conf.d/zhubofenxi.conf ]; then
  mkdir -p /root/backup-before-zhubofenxi
  cp -a /etc/nginx /root/backup-before-zhubofenxi/nginx-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
  cat >/etc/nginx/conf.d/zhubofenxi.conf <<'"'"'EOF'"'"'
server {
    listen 18080;
    listen [::]:18080;
    server_name zhurofenxi.duckdns.org;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:14723;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
  nginx -t && systemctl reload nginx
  echo "Nginx 18080 已配置"
else
  echo "Nginx 配置已存在"
fi
command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q active && ufw allow 18080/tcp 2>/dev/null || true
'@

Write-Step "安装隧道脚本与计划任务"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
@'
$ErrorActionPreference = "Continue"
$LogDir = Join-Path $env:USERPROFILE "zhubofenxi-tunnel-logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
while ($true) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content (Join-Path $LogDir "tunnel.log") "[$ts] connect"
  ssh -N -o ExitOnForwardFailure=yes -R "127.0.0.1:14723:127.0.0.1:4723" zhubofenxi-vps 2>&1 | Add-Content (Join-Path $LogDir "tunnel.log")
  Start-Sleep -Seconds 10
}
'@ | Set-Content -Path $TunnelScript -Encoding utf8

Get-Process ssh -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "14723" } | Stop-Process -Force -ErrorAction SilentlyContinue
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TunnelScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "主播分析 SSH 反向隧道" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4

Write-Step "验证隧道"
$vpsOk = $false
for ($i = 0; $i -lt 12; $i++) {
  try {
    $r = ssh -o ConnectTimeout=8 $HostAlias "curl -sS -m 5 http://127.0.0.1:14723/api/health" 2>&1
    if ($r -match '"ok"\s*:\s*true') {
      $vpsOk = $true
      Write-Host "   VPS 127.0.0.1:14723 OK" -ForegroundColor Green
      break
    }
  } catch { }
  Start-Sleep -Seconds 3
  Write-Host "   等待隧道... ($($i + 1)/12)" -ForegroundColor Gray
}

if (-not $vpsOk) {
  Write-Host "   VPS 隧道未通，查看日志: $LogDir\tunnel.log" -ForegroundColor Red
  Get-Content (Join-Path $LogDir "tunnel.log") -Tail 15 -ErrorAction SilentlyContinue
  exit 1
}

Write-Step "验证外网访问"
Start-Sleep -Seconds 2
try {
  $ext = Invoke-RestMethod "http://zhurofenxi.duckdns.org:18080/api/health" -TimeoutSec 15
  Write-Host "   外网 OK: $($ext | ConvertTo-Json -Compress)" -ForegroundColor Green
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Green
  Write-Host "  配置完成！访问地址：" -ForegroundColor Green
  Write-Host "  http://zhurofenxi.duckdns.org:18080" -ForegroundColor White
  Write-Host "  http://zhurofenxi.duckdns.org:18080/operations-report" -ForegroundColor White
  Write-Host "========================================" -ForegroundColor Green
} catch {
  Write-Host "   外网暂不可达: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "   VPS 隧道已通，可能是云厂商安全组未放行 18080" -ForegroundColor Yellow
}
