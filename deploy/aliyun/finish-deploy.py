#!/usr/bin/env python3
"""Finish deployment on server after code upload. Requires SSH_PASS."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
HOST = os.environ.get("DEPLOY_HOST", "8.137.126.18")
PASSWORD = os.environ.get("SSH_PASS", "")
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"


def safe_print(text: str) -> None:
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=60)
    return c


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 3600) -> int:
    print(f"\n>>> {cmd[:180]}...")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        safe_print(out.rstrip())
    if err.strip():
        safe_print(err.rstrip())
    return code


def main() -> None:
    if not PASSWORD:
        print("Missing SSH_PASS", file=sys.stderr)
        sys.exit(1)
    nginx_conf = (ROOT / "deploy/aliyun/nginx-zhubo-analysis.conf.example").read_text(encoding="utf-8")
    client = connect()
    try:
        run(client, "yum install -y python3.11 python3.11-devel unzip 2>&1 | tail -5")
        run(client, "id nginx >/dev/null 2>&1 || useradd -r -s /sbin/nologin nginx")
        run(
            client,
            f"""
mkdir -p /etc/aa_nginx/conf.d /www/wwwlogs
grep -q 'aa_nginx/conf.d' /etc/aa_nginx/aa_nginx.conf || sed -i '/^http {{/a \\    include /etc/aa_nginx/conf.d/*.conf;' /etc/aa_nginx/aa_nginx.conf
cat > /etc/aa_nginx/conf.d/zhubo-analysis.conf << 'NGXEOF'
{nginx_conf}
NGXEOF
/usr/sbin/aa_nginx -t
pkill aa_nginx 2>/dev/null || true
/usr/sbin/aa_nginx
sleep 1
ss -lntp | grep ':80 '
""",
        )
        code = run(client, f"cd {DEPLOY_DIR} && USE_GIT=0 SKIP_BACKUP=1 bash deploy/aliyun/deploy.sh", timeout=3600)
        if code != 0:
            sys.exit(code)
        run(client, "pm2 startup systemd -u root --hp /root 2>&1 | tail -5")
        run(client, "pm2 save")
        run(client, "curl -i --max-time 10 http://127.0.0.1:4723/api/health")
        run(client, "curl -i --max-time 10 http://127.0.0.1/api/health")
        run(client, "curl -i --max-time 15 http://8.137.126.18/api/health")
        run(client, "pm2 status")
    finally:
        client.close()


if __name__ == "__main__":
    main()
