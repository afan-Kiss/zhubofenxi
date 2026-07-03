#!/usr/bin/env python3
"""Run xiaohong/xiaoyi session diagnostic on production."""
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parents[2]


def load_pass() -> str:
    for line in (ROOT / "secrets/deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("SSH_PASS not found")


def main() -> None:
    pw = load_pass()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("8.137.126.18", username="root", password=pw, timeout=60)
    cmd = (
        "cd /www/wwwroot/zhubo-analysis && "
        "git pull origin main -q && "
        "npx tsx apps/server/scripts/diagnose-xiaohong-xiaoyi-sessions.ts 2>&1"
    )
    print(">>>", cmd[:120])
    _, out, err = client.exec_command(cmd, timeout=300)
    text = out.read().decode("utf-8", errors="replace")
    print(text)
    e = err.read().decode("utf-8", errors="replace")
    if e.strip():
        print("STDERR:", e[:2000])
    client.close()


if __name__ == "__main__":
    main()
