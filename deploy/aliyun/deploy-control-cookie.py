#!/usr/bin/env python3
"""Deploy control-cookie integration: git pull, build, patch .env, restart zhubo-analysis only."""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
CONTROL_ROOT = Path(r"e:\我的软件源码\总控台")
HOST = "8.137.126.18"
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"


def load_secrets() -> tuple[str, str]:
    ssh = ""
    token = ""
    for env_path in [CONTROL_ROOT / ".env", ROOT / ".env"]:
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("SSH_PASS="):
                ssh = line.split("=", 1)[1].strip().strip('"').strip("'")
            if line.startswith("SERVICE_TOKEN="):
                token = line.split("=", 1)[1].strip()
    cred = CONTROL_ROOT / "deploy-output-credentials.txt"
    if cred.exists():
        for line in cred.read_text(encoding="utf-8").splitlines():
            if line.startswith("SERVICE_TOKEN="):
                token = line.split("=", 1)[1].strip()
    if not ssh or not token:
        print("Missing SSH_PASS or SERVICE_TOKEN", file=sys.stderr)
        sys.exit(1)
    return ssh, token


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str]:
    print(f"\n>>> {cmd[:120]}...")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code, out + err


def main() -> None:
    ssh, token = load_secrets()
    fp = hashlib.sha256(token.encode()).hexdigest()[:12]
    print(f"SERVICE_TOKEN fp={fp}")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=ssh, timeout=60)

    patch_py = f"""
import re
from pathlib import Path
p = Path('{DEPLOY_DIR}/apps/server/.env')
text = p.read_text(encoding='utf-8') if p.exists() else ''
lines = text.splitlines()
kv = {{
  'CONTROL_SERVER_URL': 'http://8.137.126.18/control',
  'CONTROL_SERVICE_TOKEN': {token!r},
}}
out = []
seen = set()
for line in lines:
    m = re.match(r'^([A-Z0-9_]+)=', line)
    if m and m.group(1) in kv:
        out.append(f"{{m.group(1)}}={{kv[m.group(1)]}}")
        seen.add(m.group(1))
    else:
        out.append(line)
for k, v in kv.items():
    if k not in seen:
        out.append(f"{{k}}={{v}}")
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text('\\n'.join(out).rstrip() + '\\n', encoding='utf-8')
print('ENV_PATCHED')
"""

    steps = [
        f"cd {DEPLOY_DIR} && git fetch origin main && git pull --ff-only origin main",
        f"python3 - <<'PY'\n{patch_py}\nPY",
        f"cd {DEPLOY_DIR} && npm install --workspace=@live/server 2>/dev/null || (cd apps/server && npm install)",
        f"cd {DEPLOY_DIR}/apps/server && npm run build",
        "export NVM_DIR=/root/.nvm && [ -s /root/.nvm/nvm.sh ] && . /root/.nvm/nvm.sh; pm2 restart zhubo-analysis",
        "sleep 3",
        "curl -sf --max-time 8 http://127.0.0.1:4723/api/health",
        f"curl -sf --max-time 8 http://{HOST}/api/health",
        "export NVM_DIR=/root/.nvm && [ -s /root/.nvm/nvm.sh ] && . /root/.nvm/nvm.sh; pm2 status | grep -E 'analysis|control'",
    ]
    for cmd in steps:
        code, _ = run(c, cmd, timeout=900)
        if code != 0 and "git pull" not in cmd and "npm install" not in cmd:
            c.close()
            sys.exit(code)

    run(
        c,
        f"cd {DEPLOY_DIR}/apps/server && npx tsx scripts/control-cookie-acceptance.ts",
        timeout=120,
    )
    c.close()
    print("\nDEPLOY OK")


if __name__ == "__main__":
    main()
