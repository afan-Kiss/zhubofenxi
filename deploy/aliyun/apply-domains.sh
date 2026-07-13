#!/usr/bin/env bash
# 更新多域名 Nginx + CORS 配置（服务器上执行）
set -euo pipefail

DEPLOY_DIR="/www/wwwroot/zhubo-analysis"
ORIGINS="http://47.108.21.50,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz"
ENV_FILE="$DEPLOY_DIR/apps/server/.env"
NGINX_CONF="/etc/aa_nginx/conf.d/zhubo-analysis.conf"

echo "[apply-domains] update nginx server_name"
if [[ -f "$DEPLOY_DIR/deploy/aliyun/nginx-zhubo-analysis.conf.example" ]]; then
  cp "$DEPLOY_DIR/deploy/aliyun/nginx-zhubo-analysis.conf.example" "$NGINX_CONF"
else
  sed -i 's/^\s*server_name .*/    server_name 47.108.21.50 xiangyuzhubao.xyz www.xiangyuzhubao.xyz;/' "$NGINX_CONF"
fi

echo "[apply-domains] update CORS / WEB_ORIGIN in .env"
touch "$ENV_FILE"
if grep -q '^CORS_ORIGIN=' "$ENV_FILE"; then
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$ORIGINS|" "$ENV_FILE"
else
  echo "CORS_ORIGIN=$ORIGINS" >> "$ENV_FILE"
fi
if grep -q '^WEB_ORIGIN=' "$ENV_FILE"; then
  sed -i "s|^WEB_ORIGIN=.*|WEB_ORIGIN=$ORIGINS|" "$ENV_FILE"
else
  echo "WEB_ORIGIN=$ORIGINS" >> "$ENV_FILE"
fi

/usr/sbin/aa_nginx -t
systemctl reload aa_nginx 2>/dev/null || /usr/sbin/aa_nginx -s reload

pm2 restart zhubo-analysis
sleep 5

for url in \
  "http://127.0.0.1:4723/api/health" \
  "http://47.108.21.50/api/health" \
  "http://xiangyuzhubao.xyz/api/health" \
  "http://www.xiangyuzhubao.xyz/api/health"
do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo "000")
  echo "check $url -> $code"
done

echo "[apply-domains] done"
