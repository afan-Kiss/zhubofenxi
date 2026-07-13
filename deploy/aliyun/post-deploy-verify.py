#!/usr/bin/env python3
"""Post-deploy smoke checks on Aliyun. Requires SSH_PASS."""
from __future__ import annotations

import os
import sys

import paramiko

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)
from target import resolve_deploy_host

HOST = resolve_deploy_host()
PASSWORD = os.environ.get("SSH_PASS", "")
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"


def connect() -> paramiko.SSHClient:
    if not PASSWORD:
        print("Missing SSH_PASS", file=sys.stderr)
        sys.exit(1)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=60)
    return c


def run(client: paramiko.SSHClient, cmd: str) -> tuple[int, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    text = (out + err).strip()
    print(text)
    return code, text


def main() -> None:
    client = connect()
    checks: list[tuple[str, int, str]] = []

    code, text = run(
        client,
        "pm2 jlist | node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const p=j.find(x=>x.name==='zhubo-analysis');console.log('PM2_STATUS='+(p?.pm2_env?.status||'missing'));});\"",
    )
    checks.append(("pm2 online", code, text))

    for label, url in [
        ("health4723", "http://127.0.0.1:4723/api/health"),
        ("nginx_local", "http://127.0.0.1/api/health"),
        ("nginx_public", f"http://{HOST}/api/health"),
    ]:
        code, text = run(client, f"curl -s --max-time 10 {url}")
        checks.append((label, code, text))

    code, text = run(
        client,
        f"curl -s -o /dev/null -w 'HOME_HTTP=%{{http_code}}\\n' --max-time 10 http://{HOST}/",
    )
    checks.append(("frontend home", code, text))

    code, text = run(client, f"cd {DEPLOY_DIR} && npm run accept:valid-revenue-order")
    checks.append(("accept valid revenue", code, text))

    code, text = run(client, f"cd {DEPLOY_DIR} && npm run accept:operations-report")
    checks.append(("accept operations report", code, text))

    code, text = run(
        client,
        f"grep -q v11-valid-revenue-pool {DEPLOY_DIR}/apps/server/dist/services/business-metrics.service.js && echo METRICS_VERSION_OK",
    )
    checks.append(("metrics version", code, text))

    code, text = run(
        client,
        f"grep -q includedInValidRevenue {DEPLOY_DIR}/apps/server/dist/services/operations-bi-drill-row.mapper.js && echo DRILL_FIELDS_OK",
    )
    checks.append(("drill fields", code, text))

    code, text = run(
        client,
        f"grep -q '计入说明' {DEPLOY_DIR}/apps/web/dist/assets/index-*.js && echo UI_LABEL_OK",
    )
    checks.append(("ui drill label", code, text))

    client.close()

    failed = [name for name, c, t in checks if c != 0 or "FAILED" in t]
    if failed:
        print("\nPOST-DEPLOY VERIFY FAILED:", ", ".join(failed), file=sys.stderr)
        sys.exit(1)
    print("\nPOST-DEPLOY VERIFY OK")


if __name__ == "__main__":
    main()
