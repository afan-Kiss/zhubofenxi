#!/usr/bin/env bash
# 主播分析 · VPS 高端口 Nginx 反代（不占用 80/443，不碰 x-ui）
# 前提：
#   1. 本地已建立 SSH 反向隧道：127.0.0.1:14723 -> 本地 4723
#   2. curl http://127.0.0.1:14723/api/health 返回 ok
#
# 用法：SSH 登录 VPS 后执行
#   sudo bash vps-setup-nginx-18080.sh

set -euo pipefail

DOMAIN="zhurofenxi.duckdns.org"
BACKEND="127.0.0.1:14723"
LISTEN_PORT="18080"
CONF="/etc/nginx/conf.d/zhubofenxi.conf"
BACKUP_DIR="/root/backup-before-zhubofenxi"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行"
  exit 1
fi

echo "===== 安全检查：x-ui 服务状态（只读） ====="
systemctl is-active x-ui 2>/dev/null && echo "x-ui: active" || echo "x-ui: 未检测到 active（可能服务名不同，继续）"
ss -tulpn | grep -E ':80 |:443 ' || echo "80/443 当前无监听或无法读取"

echo
echo "===== 备份现有 Nginx 配置 ====="
mkdir -p "$BACKUP_DIR"
if [[ -d /etc/nginx ]]; then
  cp -a /etc/nginx "$BACKUP_DIR/nginx-$(date +%Y%m%d-%H%M%S)"
  echo "已备份到 $BACKUP_DIR"
fi

echo
echo "===== 安装 Nginx（若未安装） ====="
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx
else
  echo "Nginx 已存在：$(nginx -v 2>&1)"
fi

echo
echo "===== 写入独立配置 $CONF ====="
cat >"$CONF" <<EOF
# 主播分析外网入口 · 高端口反代 · 不影响 x-ui 80/443
server {
    listen ${LISTEN_PORT};
    listen [::]:${LISTEN_PORT};
    server_name ${DOMAIN};

    client_max_body_size 100m;

    location / {
        proxy_pass http://${BACKEND};
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

echo
echo "===== 测试并重载 Nginx ====="
nginx -t
systemctl reload nginx

echo
echo "===== 放行 ufw ${LISTEN_PORT}（若 ufw 已启用） ====="
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then
  ufw allow "${LISTEN_PORT}/tcp"
  ufw status | grep "${LISTEN_PORT}" || true
else
  echo "ufw 未启用，跳过（请勿执行 ufw reset）"
fi

echo
echo "===== VPS 本地验证 ====="
curl -sS -m 5 -i "http://127.0.0.1:${LISTEN_PORT}/api/health" || echo "若失败：请先确认本地 SSH 反向隧道已建立"

echo
echo "完成。外网访问：http://${DOMAIN}:${LISTEN_PORT}/"
echo "回滚：rm -f $CONF && nginx -t && systemctl reload nginx"
