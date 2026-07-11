#!/usr/bin/env python3
"""Trigger business sync via official API and poll until complete (max 60 min)."""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import paramiko

_SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = _SCRIPT_DIR.parents[1]
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))
from target import resolve_deploy_host

HOST = resolve_deploy_host()
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"
API = "http://127.0.0.1:4723"
MAX_WAIT_SEC = int(os.environ.get("BOSS_SYNC_MAX_WAIT_SEC", "3600"))
POLL_SEC = 30


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_pass() -> str:
    for line in (ROOT / "secrets" / "deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing SSH_PASS")


def load_credentials() -> tuple[str, str]:
    user = os.environ.get("BOSS_LIVE_USERNAME", os.environ.get("E2E_USER", "")).strip()
    pwd = os.environ.get("BOSS_LIVE_PASSWORD", os.environ.get("E2E_PASS", "")).strip()
    return user, pwd


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 60) -> tuple[int, str]:
    log(f"CMD: {cmd[:120]}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out


def main() -> None:
    user, pwd = load_credentials()
    if not user or not pwd:
        log("缺少 BOSS_LIVE_USERNAME/BOSS_LIVE_PASSWORD，无法触发经营同步")
        sys.exit(2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=load_pass(), timeout=10, look_for_keys=False, allow_agent=False)

    login_json = json.dumps({"username": user, "password": pwd})
    run(client, f"curl -s -c /tmp/boss_sync_cookie.txt -X POST {API}/api/auth/login -H 'Content-Type: application/json' -d '{login_json}'", 30)

    code, out = run(
        client,
        f"curl -s -b /tmp/boss_sync_cookie.txt -X POST {API}/api/settings/data-maintenance/trigger-business-sync -H 'Content-Type: application/json'",
        30,
    )
    log(f"trigger response: {out[:500]}")
    try:
        data = json.loads(out)
        job_id = data.get("data", {}).get("syncJobId") or data.get("syncJobId")
    except json.JSONDecodeError:
        job_id = None
    log(f"syncJobId={job_id}")

    t0 = time.time()
    last_sig = ""
    last_log = t0
    polls = 0

    while time.time() - t0 < MAX_WAIT_SEC:
        polls += 1
        elapsed_min = int((time.time() - t0) / 60)

        code, status_out = run(client, f"curl -s {API}/api/sync/status", 30)
        boss_out = ""
        try:
            _, boss_out = run(
                client,
                f"sqlite3 {DEPLOY_DIR}/apps/server/data/app.db \"SELECT id,status,trigger,datetime(startedAt),datetime(finishedAt) FROM BossSyncRunLog ORDER BY startedAt DESC LIMIT 1;\"",
                20,
            )
        except Exception:
            pass

        sig = status_out[:200] + boss_out
        job_status = "unknown"
        order_count = live_count = "?"
        try:
            j = json.loads(status_out)
            job = j.get("data", {}).get("job") or j.get("job") or {}
            job_status = job.get("status", "unknown")
            order_count = job.get("orderCount", "?")
            live_count = job.get("liveSessionCount", "?")
            is_running = job.get("isRunning", False)
            if not is_running and job_status in ("success", "partial_success", "success_empty", "failed"):
                log(f"DONE jobId={job.get('id')} status={job_status} orders={order_count} live={live_count} mins={elapsed_min}")
                log(f"BossSyncRunLog: {boss_out}")
                run(client, "pm2 logs zhubo-analysis --lines 200 --nostream 2>&1 | tail -80", 30)
                client.close()
                sys.exit(0 if job_status in ("success", "partial_success", "success_empty") else 1)
        except json.JSONDecodeError:
            is_running = True

        log(f"POLL #{polls} mins={elapsed_min} status={job_status} orders={order_count} live={live_count} boss={boss_out}")

        if sig != last_sig or time.time() - last_log >= 60:
            last_sig = sig
            last_log = time.time()
        else:
            log(f"WAITING — no change ({elapsed_min} min)")

        time.sleep(POLL_SEC)

    log(f"TIMEOUT after {MAX_WAIT_SEC}s")
    run(client, "pm2 logs zhubo-analysis --lines 200 --nostream 2>&1 | tail -80", 30)
    client.close()
    sys.exit(124)


if __name__ == "__main__":
    main()
