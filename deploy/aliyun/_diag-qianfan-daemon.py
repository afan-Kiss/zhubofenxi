#!/usr/bin/env python3
"""Diagnose qianfan-protocol-daemon restarts and resource usage."""
from __future__ import annotations

import json
from pathlib import Path

import paramiko

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
    report["pm2_describe"] = run(c, "pm2 describe qianfan-protocol-daemon")
    report["pm2_env"] = run(
        c,
        "pm2 env 0 2>/dev/null | grep -E 'NODE|memory|max_old|script|cwd' | head -30",
    )
    report["err_tail"] = run(c, "tail -100 /root/.pm2/logs/qianfan-protocol-daemon-error.log")
    report["out_tail"] = run(c, "tail -60 /root/.pm2/logs/qianfan-protocol-daemon-out.log")
    report["grep_fatal"] = run(
        c,
        "grep -E 'Error|ENOMEM|killed|FATAL|OOM|heap|memory|restart|ECONN|crash' "
        "/root/.pm2/logs/qianfan-protocol-daemon-error.log | tail -40",
    )
    report["ls_opt"] = run(c, "ls -la /opt/qianfan-protocol/; ls -la /opt/qianfan-protocol/scripts/")
    report["package_json"] = run(c, "cat /opt/qianfan-protocol/package.json")
    report["ecosystem"] = run(
        c,
        "cat /opt/qianfan-protocol/ecosystem.config.js 2>/dev/null; "
        "cat /opt/qianfan-protocol/ecosystem.config.cjs 2>/dev/null",
    )
    report["daemon_head"] = run(
        c,
        "head -150 /opt/qianfan-protocol/scripts/qianfan-protocol-daemon.js",
    )
    report["pm2_dump"] = run(c, "grep -A30 qianfan-protocol-daemon /root/.pm2/dump.pm2 | head -40")
    report["mem_now"] = run(c, "ps aux | grep qianfan-protocol | grep -v grep")

    c.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
