#!/usr/bin/env bash
# 主播分析 · 仅在确认 80/443 未被 x-ui 占用且高端口已跑通后使用
# 用法：sudo bash vps-setup-nginx-https.sh
#
# 警告：执行前务必先运行 vps-probe-readonly.sh，确认 80/443 安全可用

set -euo pipefail

DOMAIN="zhurofenxi.duckdns.org"
BACKEND="127.0.0.1:14723"
CONF="/etc/nginx/conf.d/zhubofenxi-80.conf"
BACKUP_DIR="/root/backup-before-zhubofenxi"

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行"
  exit 1
fi

echo "===== 再次确认 80/443 占用 ====="
if ss -tulpn | grep -E ':443 '; then
  echo "检测到 443 已被占用。为不影响 x-ui，中止 HTTPS 配置。"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp -a /etc/nginx "$BACKUP_DIR/nginx-before-https-$(date +%Y%m%d-%H%M%S)"

cat >"$CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
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

nginx -t
systemctl reload nginx

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update
  apt-get install -y certbot python3-certbot-nginx
fi

echo "即将运行 certbot。请确认不会影响 x-ui 现有站点。"
certbot --nginx -d "$DOMAIN"

echo "HTTPS 配置完成。请更新本地 apps/server/.env："
echo "  CORS_ORIGIN=https://${DOMAIN}"
echo "  WEB_ORIGIN=https://${DOMAIN}"
echo "  COOKIE_SECURE=true"
