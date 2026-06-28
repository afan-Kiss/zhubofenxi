#!/usr/bin/env python3
"""One-shot remote deploy helper. Reads SSH_PASS from environment only."""
from __future__ import annotations

import os
import sys
import time

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "8.137.126.18")
USER = os.environ.get("DEPLOY_USER", "root")
PASSWORD = os.environ.get("SSH_PASS", "")
PORT = int(os.environ.get("DEPLOY_SSH_PORT", "22"))


def safe_print(text: str) -> None:
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def connect() -> paramiko.SSHClient:
    if not PASSWORD:
        print("Missing SSH_PASS env", file=sys.stderr)
        sys.exit(1)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"\n>>> {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        safe_print(out.rstrip())
    if err.strip():
        safe_print(err.rstrip())
    return code, out, err


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else "probe"
    client = connect()
    try:
        if action == "probe":
            cmds = [
                "uname -a",
                "cat /etc/os-release | head -5",
                "node -v 2>/dev/null || echo NO_NODE",
                "npm -v 2>/dev/null || echo NO_NPM",
                "pm2 -v 2>/dev/null || echo NO_PM2",
                "nginx -v 2>&1 || echo NO_NGINX",
                "python3 --version 2>/dev/null || echo NO_PYTHON3",
                "ss -lntp 2>/dev/null | grep -E ':80|:4723|:8888' || netstat -lntp 2>/dev/null | grep -E ':80|:4723|:8888' || true",
                "ls -la /www/wwwroot 2>/dev/null || true",
            ]
            for c in cmds:
                run(client, c)
        elif action == "run":
            cmd = " ".join(sys.argv[2:])
            code, _, _ = run(client, cmd, timeout=3600)
            sys.exit(code)
        else:
            print(f"Unknown action: {action}", file=sys.stderr)
            sys.exit(2)
    finally:
        client.close()


if __name__ == "__main__":
    main()
