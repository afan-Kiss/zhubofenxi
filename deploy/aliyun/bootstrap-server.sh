#!/usr/bin/env bash
set -euo pipefail

log() { echo "[bootstrap] $*"; }

log "install base packages"
yum install -y gcc-c++ make tar gzip unzip curl python3.11 python3.11-devel aa_nginx unzip >/dev/null

log "install Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  yum install -y nodejs
fi
node -v
npm -v

log "install pm2"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
pm2 -v

log "nginx user + aa_nginx systemd"
id nginx >/dev/null 2>&1 || useradd -r -s /sbin/nologin nginx
mkdir -p /etc/aa_nginx/conf.d /www/wwwlogs
grep -q 'aa_nginx/conf.d' /etc/aa_nginx/aa_nginx.conf || sed -i '/^http {/a \    include /etc/aa_nginx/conf.d/*.conf;' /etc/aa_nginx/aa_nginx.conf
if [[ ! -f /etc/systemd/system/aa_nginx.service ]]; then
  cat > /etc/systemd/system/aa_nginx.service << 'EOF'
[Unit]
Description=Anolis Accelerated NGINX
After=network.target

[Service]
Type=forking
ExecStart=/usr/sbin/aa_nginx
ExecReload=/usr/sbin/aa_nginx -s reload
ExecStop=/usr/sbin/aa_nginx -s quit
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable aa_nginx
fi
systemctl restart aa_nginx || /usr/sbin/aa_nginx
ss -lntp | grep ':80 ' || true

log "bootstrap done"
