#!/usr/bin/env python3
"""Upload refresh script and rerun SF fee queries on production."""
from __future__ import annotations

import paramiko
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOST = "47.108.21.50"
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"
LOCAL_SCRIPT = ROOT / "apps/server/scripts/refresh-lucky-gift-sf-fees.ts"


def load_pass() -> str:
    for line in (ROOT / "secrets" / "deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing SSH_PASS")


def main() -> None:
    waybill = ""
    import sys

    if len(sys.argv) > 1:
        waybill = sys.argv[1].strip()

    pw = load_pass()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=pw, timeout=60)

    remote = f"{DEPLOY_DIR}/apps/server/scripts/refresh-lucky-gift-sf-fees.ts"
    sftp = c.open_sftp()
    try:
        sftp.put(str(LOCAL_SCRIPT), remote)
    finally:
        sftp.close()

    args = f" {waybill}" if waybill else ""
    cmd = f"cd {DEPLOY_DIR}/apps/server && npx tsx scripts/refresh-lucky-gift-sf-fees.ts{args}"
    _, o, e = c.exec_command(cmd, timeout=240)
    print((o.read() + e.read()).decode("utf-8", "replace"))
    c.close()


if __name__ == "__main__":
    main()
