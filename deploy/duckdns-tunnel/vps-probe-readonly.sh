#!/usr/bin/env bash
# 主播分析 · VPS 只读探测（不修改任何配置）
# 用法：SSH 登录 VPS 后执行
#   bash vps-probe-readonly.sh

set -euo pipefail

DOMAIN="zhurofenxi.duckdns.org"

echo "===== 系统信息 ====="
uname -a
cat /etc/os-release 2>/dev/null || true

echo
echo "===== 当前监听端口 ====="
ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null || true

echo
echo "===== systemd 服务（x-ui / 代理 / Web） ====="
systemctl list-units --type=service --all 2>/dev/null \
  | grep -Ei "x-ui|xray|sing-box|nginx|caddy|apache|hysteria|trojan|v2ray" || true

echo
echo "===== PM2 状态 ====="
if command -v pm2 >/dev/null 2>&1; then pm2 status; else echo "未安装 pm2"; fi

echo
echo "===== Nginx 配置目录 ====="
ls -la /etc/nginx 2>/dev/null || echo "无 /etc/nginx"
ls -la /etc/nginx/sites-enabled 2>/dev/null || true
ls -la /etc/nginx/conf.d 2>/dev/null || true

echo
echo "===== Caddy ====="
if command -v caddy >/dev/null 2>&1; then caddy version; else echo "未安装 caddy"; fi

echo
echo "===== 防火墙 ====="
if command -v ufw >/dev/null 2>&1; then ufw status verbose || true; else echo "未安装 ufw"; fi
echo "--- iptables 前 80 行 ---"
iptables -S 2>/dev/null | head -80 || true

echo
echo "===== 域名解析 ====="
getent hosts "$DOMAIN" || true

echo
echo "===== 80/443/18080/14723 占用摘要 ====="
for p in 80 443 18080 14723 54321 2053 8443; do
  if ss -tulpn 2>/dev/null | grep -q ":${p} "; then
    echo "端口 ${p}：已占用"
    ss -tulpn | grep ":${p} " || true
  else
    echo "端口 ${p}：未监听"
  fi
done

echo
echo "===== 反向隧道探测（需本地先建立 SSH -R 隧道） ====="
curl -sS -m 3 -i "http://127.0.0.1:14723/api/health" 2>/dev/null || echo "127.0.0.1:14723 暂无响应（正常：本地隧道未建立时）"

echo
echo "探测完成。本脚本未修改任何系统配置。"
