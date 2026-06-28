# 一次性：把公钥装到 VPS（需输入一次 root 密码）
$PubPath = Join-Path $env:USERPROFILE ".ssh\zhubofenxi_tunnel_ed25519.pub"
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安装 SSH 公钥到 VPS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下面会要求输入 VPS root 密码（输入时不会显示字符，正常的）" -ForegroundColor Yellow
Write-Host ""

$pub = (Get-Content $PubPath -Raw).Trim()
$cmd = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF '$pub' ~/.ssh/authorized_keys 2>/dev/null || echo '$pub' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo DONE"
ssh root@45.196.233.210 $cmd

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "公钥安装成功！可以关闭此窗口。" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "安装失败，请检查密码或网络。" -ForegroundColor Red
}
Read-Host "按 Enter 关闭"
