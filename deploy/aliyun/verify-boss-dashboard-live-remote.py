#!/usr/bin/env python3
"""Boss dashboard live validation — bounded timeouts, streaming logs, no silent hang."""
from __future__ import annotations

import json
import os
import subprocess
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
LIVE_MAX_SECONDS = int(os.environ.get("BOSS_LIVE_MAX_SECONDS", "600"))
SSH_CONNECT_TIMEOUT = 10
SSH_CMD_TIMEOUT = min(LIVE_MAX_SECONDS - 30, 540)


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_pass() -> str:
    env_file = ROOT / "secrets" / "deploy.env"
    if not env_file.exists():
        log("缺少 secrets/deploy.env，无法 SSH")
        sys.exit(2)
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    log("缺少 SSH_PASS")
    sys.exit(2)


def connect() -> paramiko.SSHClient:
    log(f"SSH 连接 {HOST} (timeout={SSH_CONNECT_TIMEOUT}s)")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        c.connect(
            HOST,
            username="root",
            password=load_pass(),
            timeout=SSH_CONNECT_TIMEOUT,
            banner_timeout=SSH_CONNECT_TIMEOUT,
            auth_timeout=SSH_CONNECT_TIMEOUT,
            look_for_keys=False,
            allow_agent=False,
        )
    except Exception as exc:
        log(f"SSH 连接失败: {exc}")
        sys.exit(2)
    log("SSH 连接成功")
    return c


def run_stream(client: paramiko.SSHClient, cmd: str, timeout: int) -> tuple[int, str]:
    log(f"REMOTE START (timeout={timeout}s): {cmd[:160]}")
    t0 = time.time()
    last_output = t0
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(1.0)
    chunks: list[str] = []

    while True:
        elapsed = time.time() - t0
        if elapsed >= timeout:
            log(f"REMOTE TIMEOUT after {int(elapsed)}s — closing channel")
            stdout.channel.close()
            return 124, "".join(chunks)

        got = False
        if stdout.channel.recv_ready():
            data = stdout.channel.recv(4096).decode("utf-8", "replace")
            if data:
                print(data, end="", flush=True)
                chunks.append(data)
                got = True
                last_output = time.time()
        if stderr.channel.recv_stderr_ready():
            data = stderr.channel.recv_stderr(4096).decode("utf-8", "replace")
            if data:
                print(data, end="", flush=True)
                chunks.append(data)
                got = True
                last_output = time.time()

        if stdout.channel.exit_status_ready():
            while stdout.channel.recv_ready():
                data = stdout.channel.recv(4096).decode("utf-8", "replace")
                if data:
                    print(data, end="", flush=True)
                    chunks.append(data)
            code = stdout.channel.recv_exit_status()
            log(f"REMOTE END exit={code} duration={int(time.time()-t0)}s")
            return code, "".join(chunks)

        if not got and time.time() - last_output >= 60:
            log(f"REMOTE WAITING — no output for 60s (elapsed {int(elapsed)}s)")
            last_output = time.time()
        time.sleep(0.2)


def load_live_credentials() -> tuple[str, str]:
    user = os.environ.get("BOSS_LIVE_USERNAME", os.environ.get("E2E_USER", "")).strip()
    pwd = os.environ.get("BOSS_LIVE_PASSWORD", os.environ.get("E2E_PASS", "")).strip()
    if user and pwd:
        return user, pwd
    env_file = ROOT / "secrets" / "deploy.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("BOSS_LIVE_USERNAME="):
                user = line.split("=", 1)[1].strip().strip('"').strip("'")
            elif line.startswith("BOSS_LIVE_PASSWORD="):
                pwd = line.split("=", 1)[1].strip().strip('"').strip("'")
    return user, pwd


def run_inline_fallback(client: paramiko.SSHClient) -> tuple[int, dict]:
    """Remote inline checks when verify-boss-dashboard-live.ts is not deployed yet."""
    log("使用内联远程验收（线上尚未部署 live 脚本）")
    live_user, live_pass = load_live_credentials()
    login_body_str = json.dumps({"username": live_user, "password": live_pass})
    script = (
        "set -e\n"
        "python3 - <<'PY'\n"
        "import json, subprocess, sqlite3, sys\n"
        'api = "http://127.0.0.1:4723"\n'
        'db = "/www/wwwroot/zhubo-analysis/apps/server/data/app.db"\n'
        'report = {"ok": True, "issues": [], "mode": "inline-fallback"}\n'
        "def issue(msg):\n"
        '    report["issues"].append(msg)\n'
        '    report["ok"] = False\n'
        '    print("  FAIL", msg, flush=True)\n'
        "def ok(msg):\n"
        '    print("  OK", msg, flush=True)\n'
        "def curl(args, timeout=30):\n"
        '    p = subprocess.run(["curl","-s","-w","\\n__HTTP__%{http_code}","--connect-timeout","10","--max-time",str(timeout)]+args,capture_output=True,text=True,timeout=timeout+5)\n'
        '    text = p.stdout or ""\n'
        '    if "__HTTP__" in text:\n'
        '        body, code = text.rsplit("__HTTP__", 1)\n'
        "        return int(code.strip()), body.strip()\n"
        "    return p.returncode, text.strip()\n"
        'print("inline verify-boss-dashboard-live", flush=True)\n'
        'code, body = curl(["-b","/tmp/none", f"{api}/api/boss-dashboard"])\n'
        "if code == 401:\n"
        '    ok("未登录 /api/boss-dashboard 返回 401")\n'
        "else:\n"
        '    issue(f"未登录应 401，实际 {code}")\n'
        f"login_payload = {json.dumps(login_body_str)}\n"
        'login_code, login_body = curl(["-c","/tmp/boss_live_cookie.txt","-X","POST",f"{api}/api/auth/login","-H","Content-Type: application/json","-d",login_payload],timeout=30)\n'
        "auth_ok = False\n"
        "try:\n"
        "    data = json.loads(login_body)\n"
        '    auth_ok = data.get("ok") is True or data.get("success") is True\n'
        "except Exception:\n"
        "    pass\n"
        "if auth_ok:\n"
        '    ok("管理员登录成功")\n'
        '    report["authSession"] = True\n'
        "else:\n"
        '    issue("缺少授权测试会话：管理员登录失败")\n'
        '    report["authSession"] = False\n'
        "if auth_ok:\n"
        '    for path in ["/api/boss-dashboard","/api/boss-dashboard/shops/shiyuju","/api/boss-dashboard/announcements"]:\n'
        '        code, _ = curl(["-b","/tmp/boss_live_cookie.txt",f"{api}{path}"])\n'
        "        if code == 200:\n"
        '            ok(f"GET {path} 200")\n'
        "        else:\n"
        '            issue(f"GET {path} 应 200，实际 {code}")\n'
        '    code, _ = curl(["-b","/tmp/boss_live_cookie.txt",f"{api}/api/boss-dashboard/shops/invalid-shop"])\n'
        "    if code == 400:\n"
        '        ok("无效 shopKey 400")\n'
        "    else:\n"
        '        issue(f"无效 shopKey 应 400，实际 {code}")\n'
        "conn = sqlite3.connect(db)\n"
        "conn.row_factory = sqlite3.Row\n"
        "cur = conn.cursor()\n"
        'shops = ["shiyuju","hetianyayu","xiangyu","xyxiangyu"]\n'
        "funds = []\n"
        "for sk in shops:\n"
        '    row = cur.execute("SELECT shopKey,liveAccountId,syncStatus,syncError,fetchedAt,availableAmountCent,balanceAmountCent,withdrawnAmountCent FROM BossFundSnapshot WHERE shopKey=? ORDER BY fetchedAt DESC LIMIT 1",(sk,)).fetchone()\n'
        '    funds.append(dict(row) if row else {"shopKey": sk, "hasSnapshot": False})\n'
        'report["fundSnapshots"] = funds\n'
        'success = [f for f in funds if f.get("syncStatus") == "success"]\n'
        "if success:\n"
        '    ok(f"{len(success)} 店有成功资金快照")\n'
        "else:\n"
        '    issue("四店均无成功资金快照（可能尚未执行老板同步）")\n'
        "flows = []\n"
        "for sk in shops:\n"
        '    total = cur.execute("SELECT COUNT(*) c FROM BossAccountFlow WHERE shopKey=?",(sk,)).fetchone()["c"]\n'
        "    withdraw = cur.execute(\"SELECT COUNT(*) c FROM BossAccountFlow WHERE shopKey=? AND flowKind='withdraw_success'\",(sk,)).fetchone()[\"c\"]\n"
        "    statement = cur.execute(\"SELECT COUNT(*) c FROM BossAccountFlow WHERE shopKey=? AND flowKind='statement_in' AND incomeAmountCent>0\",(sk,)).fetchone()[\"c\"]\n"
        '    flows.append({"shopKey":sk,"totalFlows":total,"withdrawSuccessFlows":withdraw,"statementIncomeFlows":statement})\n'
        'report["flowStats"] = flows\n'
        "scores = []\n"
        "for sk in shops:\n"
        '    row = cur.execute("SELECT shopKey,scoreDate,qualityScore,logisticsScore,serviceScore,officialOverallScore,fetchedAt FROM BossShopScoreSnapshot WHERE shopKey=? ORDER BY scoreDate DESC LIMIT 1",(sk,)).fetchone()\n'
        '    cnt = cur.execute("SELECT COUNT(*) c FROM BossShopScoreSnapshot WHERE shopKey=?",(sk,)).fetchone()["c"]\n'
        "    item = dict(row) if row else {'shopKey': sk}\n"
        "    item['historyPoints'] = cnt\n"
        "    scores.append(item)\n"
        'report["scoreStats"] = scores\n'
        'boss_run = cur.execute("SELECT id,status,trigger,errorMessage,startedAt,finishedAt FROM BossSyncRunLog ORDER BY startedAt DESC LIMIT 1").fetchone()\n'
        "report['bossSyncRun'] = dict(boss_run) if boss_run else None\n"
        "conn.close()\n"
        'print("\\n--- REPORT ---", flush=True)\n'
        "print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)\n"
        "sys.exit(0 if report['ok'] else 1)\n"
        "PY\n"
    )
    code, text = run_stream(client, script, timeout=SSH_CMD_TIMEOUT)
    report: dict = {"mode": "inline-fallback", "exit": code}
    start = text.rfind("--- REPORT ---")
    if start >= 0:
        json_part = text[start:].split("--- REPORT ---", 1)[-1].strip()
        try:
            report = json.loads(json_part)
        except json.JSONDecodeError:
            report["rawTail"] = text[-10000:]
    else:
        report["rawTail"] = text[-10000:]
    return code, report


def main() -> None:
    t0 = time.time()
    log(f"verify-boss-dashboard-live-remote START (max {LIVE_MAX_SECONDS}s)")

    if os.environ.get("DEPLOY_FIRST", "0") == "1":
        log("DEPLOY_FIRST=1: 本地 build")
        subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True, timeout=600)
        log("DEPLOY_FIRST=1: deploy")
        subprocess.run(["npm", "run", "deploy:aliyun"], cwd=ROOT, check=True, timeout=900)

    client = connect()
    report_path = ROOT / "deploy" / "aliyun" / "boss-dashboard-live-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    exit_code = 0
    try:
        check_code, check_out = run_stream(
            client,
            f"test -f {DEPLOY_DIR}/apps/server/scripts/verify-boss-dashboard-live.ts && echo LIVE_TS_OK || echo LIVE_TS_MISSING",
            15,
        )
        use_inline = "LIVE_TS_MISSING" in check_out

        if use_inline:
            code, report_data = run_inline_fallback(client)
            exit_code = code
            report_path.write_text(json.dumps(report_data, ensure_ascii=False, indent=2), encoding="utf-8")
            log(f"Report saved: {report_path}")
        else:
            live_user, live_pass = load_live_credentials()
            sync_flag = os.environ.get("BOSS_LIVE_RUN_SYNC", "0")
            sync_max = os.environ.get("BOSS_LIVE_SYNC_MAX_SECONDS", "120")
            remote_cmd = (
                f"cd {DEPLOY_DIR} && "
                f"BOSS_LIVE_RUN_SYNC={sync_flag} "
                f"BOSS_LIVE_SYNC_MAX_SECONDS={sync_max} "
                f"BOSS_LIVE_LOGIN_TIMEOUT_MS=30000 "
                f"BOSS_LIVE_HTTP_TIMEOUT_MS=30000 "
                f"BOSS_LIVE_USERNAME={json.dumps(live_user)} "
                f"BOSS_LIVE_PASSWORD={json.dumps(live_pass)} "
                f"npx tsx apps/server/scripts/verify-boss-dashboard-live.ts"
            )
            code, text = run_stream(client, remote_cmd, timeout=SSH_CMD_TIMEOUT)
            exit_code = code

            start = text.rfind("--- REPORT ---")
            if start >= 0:
                json_part = text[start:].split("--- REPORT ---", 1)[-1].strip()
                try:
                    parsed = json.loads(json_part)
                    report_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
                except json.JSONDecodeError:
                    report_path.write_text(json.dumps({"rawTail": text[-20000:], "exit": code}), encoding="utf-8")
            else:
                report_path.write_text(json.dumps({"rawTail": text[-20000:], "exit": code}), encoding="utf-8")
            log(f"Report saved: {report_path}")

        run_stream(client, "curl -s --connect-timeout 10 --max-time 15 http://127.0.0.1:4723/api/health", 20)
        run_stream(
            client,
            "pm2 jlist 2>/dev/null | node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const p=j.find(x=>x.name==='zhubo-analysis');console.log('PM2',p?.pm2_env?.status||'missing');});\"",
            20,
        )
    finally:
        client.close()

    if os.environ.get("BOSS_LIVE_PLAYWRIGHT", "0") == "1":
        log("Playwright browser check (optional)")
        env = os.environ.copy()
        env["E2E_BASE_URL"] = "https://xiangyuzhubao.xyz/zhubofenxi"
        try:
            pw = subprocess.run(
                ["npx", "playwright", "test", "tests/e2e/boss-dashboard-live.spec.ts", "--project=local-chrome"],
                cwd=ROOT,
                env=env,
                timeout=180,
            )
            if pw.returncode != 0:
                log("Playwright failed (non-fatal)")
        except subprocess.TimeoutExpired:
            log("Playwright timeout (non-fatal)")

    log(f"DONE total={int(time.time()-t0)}s exit={exit_code}")
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
