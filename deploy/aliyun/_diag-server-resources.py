#!/usr/bin/env python3
"""Diagnose production server CPU/memory and zhubo-analysis state."""
from __future__ import annotations

import json
import paramiko
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOST = "47.108.21.50"


def load_pass() -> str:
    for line in (ROOT / "secrets" / "deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing SSH_PASS")


def run(c, cmd: str, timeout: int = 90) -> str:
    _, o, e = c.exec_command(cmd, timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", "replace").strip()


def main() -> None:
    pw = load_pass()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=pw, timeout=60)

    report: dict[str, object] = {}
    report["uptime"] = run(c, "uptime")
    report["mem"] = run(c, "free -h")
    report["disk"] = run(c, "df -h / /www")
    report["cpu_top"] = run(c, "ps aux --sort=-%cpu | head -15")
    report["mem_top"] = run(c, "ps aux --sort=-%mem | head -15")
    report["pm2_list"] = run(c, "pm2 list")
    report["health"] = run(c, "curl -s http://127.0.0.1:4723/api/health")
    report["snapshots"] = run(
        c,
        "ls -lh /www/wwwroot/zhubo-analysis/apps/server/data/board-snapshots 2>/dev/null | head -15 || echo '(none)'",
    )
    report["pm2_restarts"] = run(
        c,
        "pm2 describe zhubo-analysis 2>/dev/null | grep -E 'restarts|uptime|memory|cpu'",
    )
    report["daemon_restarts"] = run(
        c,
        "pm2 describe qianfan-protocol-daemon 2>/dev/null | grep -E 'restarts|uptime|memory|cpu'",
    )
    report["zhubo_log_tail"] = run(
        c,
        "tail -20 /root/.pm2/logs/zhubo-analysis-out.log 2>/dev/null",
    )
    report["zhubo_err_tail"] = run(
        c,
        "tail -15 /root/.pm2/logs/zhubo-analysis-error.log 2>/dev/null",
    )
    report["grep_rebuild"] = run(
        c,
        "grep -c '重新构建完成' /root/.pm2/logs/zhubo-analysis-out.log 2>/dev/null || echo 0",
    )
    report["grep_database_locked"] = run(
        c,
        "grep -c 'database is locked' /root/.pm2/logs/zhubo-analysis-error.log 2>/dev/null || echo 0",
    )

    c.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
