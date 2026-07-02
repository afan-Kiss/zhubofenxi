#!/usr/bin/env python3
import os
import sys
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parents[2]

def load_ssh_pass() -> str:
    for env_path in [
        ROOT / "secrets" / "deploy.env",
        Path(r"e:\我的软件源码\总控台") / ".env",
        ROOT / ".env",
    ]:
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("SSH_PASS="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val
    return os.environ.get("SSH_PASS", "")

def run_remote(cmd: str) -> int:
    password = load_ssh_pass()
    if not password:
        raise SystemExit("SSH_PASS not found")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("8.137.126.18", username="root", password=password, timeout=30)
    print(">>>", cmd)
    _, stdout, stderr = client.exec_command(f"cd /www/wwwroot/zhubo-analysis && {cmd}", timeout=600)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    code = stdout.channel.recv_exit_status()
    client.close()
    return code

def main() -> None:
    from datetime import date

    apply = "--apply" in sys.argv
    today = date.today().isoformat()
    cmd = (
        f"REPAIR_SCHEDULE_FROM=2026-07-01 REPAIR_SCHEDULE_TO={today} "
        "npx tsx apps/server/scripts/repair-manual-schedule-20260701.ts"
    )
    if apply:
        cmd += " --apply"
    code = run_remote(cmd)
    raise SystemExit(code)

if __name__ == "__main__":
    main()
