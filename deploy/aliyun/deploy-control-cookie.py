#!/usr/bin/env python3
"""Deploy control-cookie: zip upload, build, patch .env, restart zhubo-analysis only."""
from __future__ import annotations

import hashlib
import re
import sys
import tempfile
import zipfile
from pathlib import Path

import paramiko

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))
from target import control_server_url, resolve_deploy_host

ROOT = Path(__file__).resolve().parents[2]
CONTROL_ROOT = Path(r"e:\我的软件源码\总控台")
HOST = resolve_deploy_host()
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"
SKIP_DIRS = {"node_modules", ".git", "dist", "release", "out", "build", ".vite", "reports", "debug", "打包输出"}


def load_secrets() -> tuple[str, str]:
    ssh = token = ""
    for env_path in [CONTROL_ROOT / ".env", ROOT / ".env"]:
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("SSH_PASS="):
                ssh = line.split("=", 1)[1].strip().strip('"').strip("'")
            if line.startswith("SERVICE_TOKEN="):
                token = line.split("=", 1)[1].strip()
    if not ssh or not token:
        print("Missing SSH_PASS or SERVICE_TOKEN", file=sys.stderr)
        sys.exit(1)
    return ssh, token


def should_skip(rel: str) -> bool:
    parts = rel.replace("\\", "/").split("/")
    if parts[0] in SKIP_DIRS:
        return True
    if ".env" in parts:
        return True
    if "apps/server/dist" in rel.replace("\\", "/"):
        return True
    if "apps/web/dist" in rel.replace("\\", "/"):
        return True
    return False


def safe_print(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
    sys.stdout.buffer.write(b"\n")


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 600) -> int:
    safe_print(f"\n>>> {cmd[:140]}")
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        safe_print(out.rstrip())
    if err.strip():
        safe_print("STDERR: " + err.rstrip())
    return code


def main() -> None:
    ssh, token = load_secrets()
    safe_print(f"SERVICE_TOKEN fp={hashlib.sha256(token.encode()).hexdigest()[:12]}")

    with tempfile.TemporaryDirectory() as td:
        zip_path = Path(td) / "patch.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            count = 0
            for path in ROOT.rglob("*"):
                if not path.is_file():
                    continue
                rel = str(path.relative_to(ROOT))
                if should_skip(rel):
                    continue
                zf.write(path, rel)
                count += 1
        safe_print(f"Packed {count} files")

        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect(HOST, username="root", password=ssh, timeout=60)
        sftp = c.open_sftp()
        sftp.put(str(zip_path), "/tmp/zhubo-control-cookie-patch.zip")
        sftp.close()

        patch_env = f"""
import re
from pathlib import Path
p = Path('{DEPLOY_DIR}/apps/server/.env')
lines = p.read_text(encoding='utf-8').splitlines() if p.exists() else []
kv = {{'CONTROL_SERVER_URL': '{control_server_url(HOST)}', 'CONTROL_SERVICE_TOKEN': {token!r}}}
out, seen = [], set()
for line in lines:
    m = re.match(r'^([A-Z0-9_]+)=', line)
    if m and m.group(1) in kv:
        out.append(f"{{m.group(1)}}={{kv[m.group(1)]}}"); seen.add(m.group(1))
    else: out.append(line)
for k,v in kv.items():
    if k not in seen: out.append(f"{{k}}={{v}}")
p.write_text('\\n'.join(out).rstrip()+'\\n', encoding='utf-8')
print('ENV_PATCHED')
"""

        steps = [
            f"mkdir -p {DEPLOY_DIR} && unzip -oq /tmp/zhubo-control-cookie-patch.zip -d {DEPLOY_DIR}",
            f"python3 - <<'PY'\n{patch_env}\nPY",
            f"cd {DEPLOY_DIR}/apps/server && npm run build",
            "export NVM_DIR=/root/.nvm; [ -s /root/.nvm/nvm.sh ] && . /root/.nvm/nvm.sh; pm2 restart zhubo-analysis",
            "sleep 4",
            "curl -sf --max-time 10 http://127.0.0.1:4723/api/health",
            f"curl -sf --max-time 10 http://{HOST}/api/health",
            "export NVM_DIR=/root/.nvm; [ -s /root/.nvm/nvm.sh ] && . /root/.nvm/nvm.sh; pm2 status | grep analysis",
            f"cd {DEPLOY_DIR}/apps/server && npx tsx scripts/control-cookie-acceptance.ts",
        ]
        for cmd in steps:
            code = run(c, cmd, timeout=900)
            if code != 0:
                c.close()
                sys.exit(code)
        c.close()
    safe_print("\nDEPLOY OK")


if __name__ == "__main__":
    main()
