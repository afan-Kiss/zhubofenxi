#!/usr/bin/env python3
"""Post-deploy: verify v2 cooldown hashes, trigger one business sync, poll 10min, audit DB."""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import paramiko

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from target import resolve_deploy_host

HOST = resolve_deploy_host()
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"
API = "http://127.0.0.1:4723"
DB = f"{DEPLOY_DIR}/apps/server/data/app.db"
MAX_WAIT_SEC = int(os.environ.get("BOSS_SYNC_MAX_WAIT_SEC", "600"))
POLL_SEC = 15


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
    log(f"RUN ({timeout}s): {cmd[:140]}")
    t0 = time.time()
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace").strip()
    code = stdout.channel.recv_exit_status()
    log(f"DONE exit={code} elapsed={int(time.time()-t0)}s")
    return code, out


def main() -> None:
    user, pwd = load_credentials()
    if not user or not pwd:
        log("缺少 BOSS_LIVE_USERNAME/BOSS_LIVE_PASSWORD")
        sys.exit(2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=load_pass(), timeout=10, look_for_keys=False, allow_agent=False)

    _, health = run(client, f"curl -s --connect-timeout 5 --max-time 10 {API}/api/health", 15)
    log(f"health: {health[:120]}")

    _, running = run(
        client,
        f"""sqlite3 {DB} "SELECT COUNT(*) FROM XhsSyncJob WHERE status IN ('running','pending') AND preset='daily_strategy';" """,
        20,
    )
    log(f"active jobs (running+pending): {running}")
    if running.strip() not in ("0", ""):
        log("仍有活跃任务，不触发新同步")
        sys.exit(3)

    hash_script = r"""
const { BOSS_DASHBOARD_SHOPS } = require('./apps/server/dist/config/boss-dashboard.constants.js');
const { previewBossAggregateRequestHash } = require('./apps/server/dist/services/boss-dashboard/boss-dashboard-api.service.js');
(async () => {
  for (const shop of BOSS_DASHBOARD_SHOPS) {
    const p = await previewBossAggregateRequestHash(shop);
    if (!p) { console.log(shop.shopKey + ' NONE'); continue; }
    console.log(p.shopKey + ' scope=' + p.scopeKey.slice(0,24) + ' hash=' + p.hash.slice(0,12));
  }
})().catch(e => { console.error(e); process.exit(1); });
"""
    _, hash_out = run(
        client,
        f"cd {DEPLOY_DIR} && node -e {json.dumps(hash_script)}",
        45,
    )
    print("\n=== v2 cooldown hash preview ===")
    print(hash_out)

    login_json = json.dumps({"username": user, "password": pwd})
    run(client, f"curl -s -c /tmp/boss_v2_cookie.txt -X POST {API}/api/auth/login -H 'Content-Type: application/json' -d '{login_json}'", 30)

    code, out = run(
        client,
        f"curl -s -b /tmp/boss_v2_cookie.txt -X POST {API}/api/settings/data-maintenance/trigger-business-sync -H 'Content-Type: application/json'",
        30,
    )
    log(f"trigger: {out[:400]}")
    try:
        data = json.loads(out)
        job_id = data.get("data", {}).get("syncJobId") or data.get("syncJobId")
        already = data.get("data", {}).get("alreadyRunning")
    except json.JSONDecodeError:
        job_id = None
        already = None
    if not job_id:
        log("未拿到 jobId")
        sys.exit(4)
    log(f"jobId={job_id} alreadyRunning={already}")

    t0 = time.time()
    last_sig = ""
    last_change = t0
    while time.time() - t0 < MAX_WAIT_SEC:
        _, row = run(
            client,
            f"""sqlite3 {DB} "SELECT status,orderCount,liveSessionCount,currentStep,progress FROM XhsSyncJob WHERE id='{job_id}';" """,
            20,
        )
        _, boss = run(
            client,
            f"""sqlite3 {DB} "SELECT status,substr(errorMessage,1,120) FROM BossSyncRunLog ORDER BY createdAt DESC LIMIT 1;" """,
            20,
        )
        elapsed = int(time.time() - t0)
        sig = f"{row}|{boss}"
        log(f"POLL jobId={job_id} elapsed={elapsed}s job={row} boss={boss}")
        if sig != last_sig:
            last_sig = sig
            last_change = time.time()
        if row and row.split("|")[0] in ("success", "partial_success", "failed", "success_empty"):
            log("主任务已结束")
            break
        if time.time() - last_change >= 60:
            log(f"WAITING：轮询中 jobId={job_id} 已等待 {elapsed}s")
            last_change = time.time()
        time.sleep(POLL_SEC)
    else:
        log("10 分钟超时，停止本地等待（服务器可能仍在跑）")

    audit_cmds = [
        ("job", f"sqlite3 -header -column {DB} \"SELECT id,status,startedBy,orderCount,liveSessionCount,errorMessage FROM XhsSyncJob WHERE id='{job_id}';\""),
        ("boss", f"sqlite3 -header -column {DB} \"SELECT id,status,trigger,errorMessage FROM BossSyncRunLog ORDER BY createdAt DESC LIMIT 2;\""),
        ("fund", f"sqlite3 {DB} \"SELECT shopKey,syncStatus,availableAmountCent,balanceAmountCent,fetchedAt FROM BossFundSnapshot ORDER BY fetchedAt DESC LIMIT 8;\""),
        ("flow", f"sqlite3 {DB} \"SELECT shopKey,COUNT(*) FROM BossAccountFlow GROUP BY shopKey;\""),
        ("score", f"sqlite3 {DB} \"SELECT shopKey,scoreDate,qualityScore,logisticsScore,serviceScore,sourceApi FROM BossShopScoreSnapshot ORDER BY scoreDate DESC LIMIT 8;\""),
    ]
    for label, cmd in audit_cmds:
        print(f"\n=== {label} ===")
        _, o = run(client, cmd, 30)
        print(o)

    client.close()


if __name__ == "__main__":
    main()
