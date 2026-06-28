#!/usr/bin/env python3
"""Grant super_admin to a user on remote server via sqlite3. Requires SSH_PASS."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "8.137.126.18")
PASSWORD = os.environ.get("SSH_PASS", "")
DB = "/www/wwwroot/zhubo-analysis/apps/server/data/app.db"
USERNAME = sys.argv[1] if len(sys.argv) > 1 else "fanfan"


def run(client: paramiko.SSHClient, cmd: str) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    return stdout.channel.recv_exit_status(), out, err


def main() -> None:
    if not PASSWORD:
        print("Missing SSH_PASS", file=sys.stderr)
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    try:
        list_cmd = f"sqlite3 {DB} \"SELECT username, role, enabled FROM User;\""
        print(">>> current users")
        code, out, err = run(client, list_cmd)
        print(out.rstrip() or err.rstrip())
        if code != 0:
            sys.exit(code)

        update_cmd = (
            f"sqlite3 {DB} "
            f"\"UPDATE User SET role='super_admin', enabled=1, updatedAt=datetime('now') "
            f"WHERE username='{USERNAME}'; SELECT changes();\""
        )
        print(f">>> promote {USERNAME}")
        code, out, err = run(client, update_cmd)
        changed = out.strip()
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if code != 0:
            sys.exit(code)
        if changed == "0":
            print(f"[grant] user not found or no change: {USERNAME}")
            sys.exit(1)
        print(f"[grant] {USERNAME} promoted to super_admin ({changed} row)")

        _, out, _ = run(client, list_cmd)
        print(out.rstrip())
    finally:
        client.close()


if __name__ == "__main__":
    main()
