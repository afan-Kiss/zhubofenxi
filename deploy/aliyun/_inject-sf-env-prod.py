#!/usr/bin/env python3
"""Inject SF waybill config into production apps/server/.env and restart API."""
from __future__ import annotations

import json
import paramiko
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOST = "47.108.21.50"
ENV_PATH = "/www/wwwroot/zhubo-analysis/apps/server/.env"
SF_CONFIG_PATH = Path(r"E:\我的软件源码\小红书运费顺丰真实查询\config.json")
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"

SF_KEYS = [
    "SF_PARTNER_ID",
    "SF_CHECK_WORD",
    "SF_CHECK_WORD_SANDBOX",
    "SF_MONTHLY_CARD",
    "SF_PHONE_LAST4",
]


def load_pass() -> str:
    for line in (ROOT / "secrets" / "deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing SSH_PASS")


def load_sf_from_config() -> dict[str, str]:
    data = json.loads(SF_CONFIG_PATH.read_text(encoding="utf-8"))
    sf = data.get("sf") or {}
    mapping = {
        "SF_PARTNER_ID": str(sf.get("partnerID") or "").strip(),
        "SF_CHECK_WORD": str(sf.get("checkWord") or "").strip(),
        "SF_CHECK_WORD_SANDBOX": str(sf.get("checkWordSandbox") or "").strip(),
        "SF_MONTHLY_CARD": str(sf.get("monthlyCard") or "").strip(),
        "SF_PHONE_LAST4": str(sf.get("phoneLast4") or "").strip(),
    }
    if not mapping["SF_PARTNER_ID"] or not mapping["SF_CHECK_WORD"] or not mapping["SF_MONTHLY_CARD"]:
        raise SystemExit("config.json missing partnerID/checkWord/monthlyCard")
    return mapping


def merge_env(text: str, values: dict[str, str]) -> str:
    lines = text.splitlines()
    out: list[str] = []
    seen: set[str] = set()
    key_re = re.compile(r"^([A-Z0-9_]+)=")
    for line in lines:
        m = key_re.match(line.strip())
        if m and m.group(1) in values:
            key = m.group(1)
            val = values[key]
            if val:
                out.append(f"{key}={val}")
            seen.add(key)
            continue
        out.append(line)
    for key in SF_KEYS:
        if key in values and key not in seen and values[key]:
            out.append(f"{key}={values[key]}")
    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    values = load_sf_from_config()
    pw = load_pass()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=pw, timeout=60)

    sftp = client.open_sftp()
    try:
        with sftp.open(ENV_PATH, "r") as f:
            current = f.read().decode("utf-8", errors="replace")
    finally:
        sftp.close()

    merged = merge_env(current, values)
    sftp = client.open_sftp()
    try:
        with sftp.open(ENV_PATH, "w") as f:
            f.write(merged.encode("utf-8"))
    finally:
        sftp.close()

    restart_cmd = (
        f"cd {DEPLOY_DIR} && "
        "pm2 restart zhubo-analysis --update-env 2>/dev/null || "
        "pm2 restart all --update-env 2>/dev/null || "
        "pm2 restart 0 --update-env"
    )
    _, out, err = client.exec_command(restart_cmd, timeout=120)
    restart_out = (out.read() + err.read()).decode("utf-8", "replace").strip()

    _, health_out, _ = client.exec_command("curl -s http://127.0.0.1:4723/api/health", timeout=30)
    health = health_out.read().decode("utf-8", "replace").strip()

    test_cmd = (
        f"cd {DEPLOY_DIR}/apps/server && "
        "npx tsx scripts/probe-sf-waybill.ts SF0217513214647 SF0210344598553"
    )
    _, test_out, test_err = client.exec_command(test_cmd, timeout=60)
    test_raw = (test_out.read() + test_err.read()).decode("utf-8", "replace").strip()

    report = {
        "sfConfigured": True,
        "sfPartnerId": values["SF_PARTNER_ID"],
        "sfMonthlyCardTail": values["SF_MONTHLY_CARD"][-4:],
        "health": health,
        "restartTail": restart_out.splitlines()[-3:] if restart_out else [],
        "waybillTest": test_raw,
    }
    print(json.dumps(report, ensure_ascii=True, indent=2))
    client.close()


if __name__ == "__main__":
    main()
