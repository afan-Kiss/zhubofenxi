#!/usr/bin/env python3
"""Poll existing post-deploy sync job (no re-trigger)."""
from __future__ import annotations

import json
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
DB = f"{DEPLOY_DIR}/apps/server/data/app.db"
JOB_ID = sys.argv[1] if len(sys.argv) > 1 else "cmrg8c9td000bniylb8zgmdcr"
MAX_WAIT = 600
POLL = 15


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_pass() -> str:
    for line in (ROOT / "secrets" / "deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing SSH_PASS")


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 45) -> str:
    _, o, e = c.exec_command(cmd, timeout=timeout)
    return (o.read() + e.read()).decode("utf-8", "replace").strip()


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=load_pass(), timeout=10)

    preview_local = ROOT / "apps/server/scripts/preview-boss-cooldown-hashes.ts"
    if preview_local.exists():
        sftp = c.open_sftp()
        sftp.put(str(preview_local), f"{DEPLOY_DIR}/apps/server/scripts/preview-boss-cooldown-hashes.ts")
        sftp.close()
        log("uploaded preview script")
        print("\n=== v2 hash preview ===")
        print(run(c, f"cd {DEPLOY_DIR} && npx tsx apps/server/scripts/preview-boss-cooldown-hashes.ts", 90))

    t0 = time.time()
    last_sig = ""
    last_change = t0
    while time.time() - t0 < MAX_WAIT:
        row = run(
            c,
            f"""sqlite3 {DB} "SELECT status,orderCount,liveSessionCount,currentStep,currentStepLabel,progress,startedBy FROM XhsSyncJob WHERE id='{JOB_ID}';" """,
            25,
        )
        boss = run(
            c,
            f"""sqlite3 {DB} "SELECT status,substr(errorMessage,1,160) FROM BossSyncRunLog ORDER BY createdAt DESC LIMIT 1;" """,
            25,
        )
        elapsed = int(time.time() - t0)
        log(f"POLL jobId={JOB_ID} elapsed={elapsed}s job={row} boss={boss}")
        sig = row + boss
        if sig != last_sig:
            last_sig = sig
            last_change = time.time()
        status = row.split("|")[0] if row else ""
        if status in ("success", "partial_success", "failed", "success_empty"):
            break
        if time.time() - last_change >= 60:
            log(f"WAITING：轮询 jobId={JOB_ID} status={status} 已等待 {elapsed}s")
            last_change = time.time()
        time.sleep(POLL)
    else:
        log("10 分钟超时")

    for label, cmd in [
        ("job", f'sqlite3 -header -column {DB} "SELECT id,status,startedBy,orderCount,liveSessionCount,errorMessage FROM XhsSyncJob WHERE id=\'{JOB_ID}\';"'),
        ("boss", f"sqlite3 -header -column {DB} \"SELECT id,status,trigger,errorMessage,substr(shopResults,1,800) FROM BossSyncRunLog ORDER BY createdAt DESC LIMIT 1;\""),
        ("fund", f"sqlite3 {DB} \"SELECT shopKey,syncStatus,availableAmountCent,balanceAmountCent,afterSaleFrozenAmountCent,datetime(fetchedAt) FROM BossFundSnapshot ORDER BY fetchedAt DESC LIMIT 8;\""),
        ("flow", f"sqlite3 {DB} \"SELECT shopKey,COUNT(*) FROM BossAccountFlow GROUP BY shopKey;\""),
        ("score", f"sqlite3 {DB} \"SELECT shopKey,scoreDate,qualityScore,logisticsScore,serviceScore,sourceApi FROM BossShopScoreSnapshot ORDER BY scoreDate DESC LIMIT 8;\""),
        ("audit", "grep -h 'boss_account_summary' /www/wwwroot/zhubo-analysis/apps/server/data/sync-request-audit/2026-07-11.jsonl 2>/dev/null | tail -8"),
    ]:
        print(f"\n=== {label} ===")
        print(run(c, cmd, 40))

    c.close()


if __name__ == "__main__":
    main()
