#!/usr/bin/env bash
# VPS 上检查反向隧道是否生效（SSH 登录 VPS 后执行）
set -euo pipefail

echo "===== 1. 14723 是否在监听 ====="
ss -tlnp | grep 14723 || echo "未监听 → 本地 SSH 隧道未建立或已断开"

echo
echo "===== 2. 直连隧道后端 ====="
curl -sS -m 5 -i http://127.0.0.1:14723/api/health || echo "curl 失败 → 隧道不通"

echo
echo "===== 3. Nginx 18080 配置 ====="
grep -r "14723\|18080\|zhubofenxi" /etc/nginx/conf.d/ /etc/nginx/sites-enabled/ 2>/dev/null || true

echo
echo "===== 4. Nginx 经 18080 访问 ====="
curl -sS -m 5 -i -H "Host: zhurofenxi.duckdns.org" http://127.0.0.1:18080/api/health || echo "18080 失败"

echo
echo "===== 5. sshd 是否允许端口转发 ====="
grep -E "^AllowTcpForwarding|^GatewayPorts" /etc/ssh/sshd_config 2>/dev/null || echo "（使用默认）"

echo
echo "===== 6. 防火墙 18080 ====="
command -v ufw >/dev/null 2>&1 && ufw status | grep 18080 || echo "ufw 未启用或未放行 18080"
