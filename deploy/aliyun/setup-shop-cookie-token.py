#!/usr/bin/env python3
"""Ensure SHOP_COOKIE_UPLOAD_TOKEN on server and print it."""
from __future__ import annotations

import re
import secrets
import sys
import time
from pathlib import Path

import paramiko

_SCRIPT_DIR = Path(__file__).resolve().parent
import sys
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))
from target import resolve_deploy_host

ROOT = Path(__file__).resolve().parents[2]
HOST = resolve_deploy_host()
USER = "root"
ENV_PATH = "/www/wwwroot/zhubo-analysis/apps/server/.env"


def load_pass() -> str:
    for p in [ROOT / "secrets" / "deploy.env", ROOT / ".env"]:
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith("SSH_PASS="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val
    print("Missing SSH_PASS", file=sys.stderr)
    sys.exit(1)


def run(client: paramiko.SSHClient, cmd: str) -> tuple[int, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, (out + err).strip()


def main() -> None:
    token = secrets.token_urlsafe(32)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=load_pass(), timeout=60)
    try:
        _, text = run(client, f"cat {ENV_PATH}")
        m = re.search(r"^SHOP_COOKIE_UPLOAD_TOKEN=(.*)$", text, re.M)
        if m and m.group(1).strip():
            token = m.group(1).strip()
            print("SHOP_COOKIE_UPLOAD_TOKEN already set on server")
        elif "SHOP_COOKIE_UPLOAD_TOKEN=" in text:
            run(client, f"sed -i 's/^SHOP_COOKIE_UPLOAD_TOKEN=.*/SHOP_COOKIE_UPLOAD_TOKEN={token}/' {ENV_PATH}")
            print("Updated SHOP_COOKIE_UPLOAD_TOKEN on server")
        else:
            run(client, f"echo 'SHOP_COOKIE_UPLOAD_TOKEN={token}' >> {ENV_PATH}")
            print("Appended SHOP_COOKIE_UPLOAD_TOKEN to server .env")

        run(client, "pm2 restart zhubo-analysis")
        time.sleep(3)
        code, body = run(
            client,
            f'curl -s -w "\\nHTTP_CODE:%{{http_code}}" http://127.0.0.1:4723/api/shop-cookies/status -H "Authorization: Bearer {token}"',
        )
        print(body)
        if "HTTP_CODE:200" not in body:
            sys.exit(1)
        print(f"\nTOKEN={token}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
