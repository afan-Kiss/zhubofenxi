#!/usr/bin/env python3
"""Upload project bundle and run deploy on Aliyun server. Requires SSH_PASS env."""
from __future__ import annotations

import os
import re
import secrets
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
HOST = os.environ.get("DEPLOY_HOST", "8.137.126.18")
USER = os.environ.get("DEPLOY_USER", "root")
PASSWORD = os.environ.get("SSH_PASS", "")
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"

SKIP_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "release",
    "out",
    "build",
    ".vite",
    "reports",
    "debug",
    "打包输出",
    "_pack_for_chatgpt",
}
SKIP_FILE_SUFFIX = {".db-journal", ".log", ".zip"}
SKIP_PATH_PARTS = {".venv", "__pycache__", "apps/server/dist", "apps/web/dist"}


def connect() -> paramiko.SSHClient:
    if not PASSWORD:
        print("Missing SSH_PASS", file=sys.stderr)
        sys.exit(1)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=60)
    return c


def safe_print(text: str) -> None:
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 3600) -> int:
    print(f"\n>>> {cmd[:200]}{'...' if len(cmd) > 200 else ''}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        safe_print(out.rstrip())
    if err.strip():
        safe_print(err.rstrip())
    return code


def should_skip(rel: str) -> bool:
    parts = rel.replace("\\", "/").split("/")
    if parts[0] in SKIP_DIRS:
        return True
    for part in parts:
        if part in SKIP_DIRS or part == ".env":
            return True
    rel_norm = rel.replace("\\", "/")
    for part in SKIP_PATH_PARTS:
        if part in rel_norm:
            return True
    if rel_norm.endswith("tsconfig.tsbuildinfo"):
        return True
    if any(rel_norm.endswith(s) for s in SKIP_FILE_SUFFIX):
        return True
    return False


def build_zip(zip_path: Path) -> None:
    print(f"Building zip -> {zip_path}")
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in ROOT.rglob("*"):
            if not path.is_file():
                continue
            rel = str(path.relative_to(ROOT))
            if should_skip(rel):
                continue
            zf.write(path, rel)
            count += 1
    print(f"Packed {count} files")


def build_env_content() -> str:
    src = ROOT / "apps/server/.env"
    lines: list[str] = []
    if src.exists():
        lines = src.read_text(encoding="utf-8").splitlines()
    else:
        example = ROOT / "deploy/aliyun/env.server.example"
        lines = example.read_text(encoding="utf-8").splitlines()

    overrides = {
        "NODE_ENV": "production",
        "HOST": "127.0.0.1",
        "PORT": "4723",
        "WEB_ORIGIN": "http://8.137.126.18,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz",
        "CORS_ORIGIN": "http://8.137.126.18,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz",
        "COOKIE_SECURE": "false",
        "AUTH_MODE": "session",
        "AUTH_ALLOW_REGISTER": "true",
        "XHS_SIGNER_ENABLED": "true",
        "XHS_SIGNER_PYTHON": "tools/xhs_signer/.venv/bin/python",
        "DATABASE_URL": "file:../data/app.db",
    }

    if not any(l.startswith("SESSION_SECRET=") and "请替换" not in l for l in lines):
        overrides["SESSION_SECRET"] = secrets.token_urlsafe(48)
    if not any(l.startswith("COOKIE_ENCRYPTION_KEY=") and "请替换" not in l and len(l.split("=", 1)[-1]) >= 32 for l in lines if l.startswith("COOKIE_ENCRYPTION_KEY=")):
        overrides["COOKIE_ENCRYPTION_KEY"] = secrets.token_urlsafe(48)

    out: list[str] = []
    seen: set[str] = set()
    key_re = re.compile(r"^([A-Z0-9_]+)=")
    for line in lines:
        m = key_re.match(line.strip())
        if m:
            key = m.group(1)
            if key in overrides:
                out.append(f"{key}={overrides[key]}")
                seen.add(key)
                continue
        out.append(line)
    for key, val in overrides.items():
        if key not in seen:
            out.append(f"{key}={val}")
    return "\n".join(out) + "\n"


def sftp_put(client: paramiko.SSHClient, local: Path, remote: str) -> None:
    print(f"Upload {local.name} -> {remote}")
    sftp = client.open_sftp()
    try:
        sftp.put(str(local), remote)
    finally:
        sftp.close()


def main() -> None:
    client = connect()
    try:
        if os.environ.get("DEPLOY_BOOTSTRAP", "0") == "1":
            bootstrap = (ROOT / "deploy/aliyun/bootstrap-server.sh").read_text(encoding="utf-8")
            run(client, f"cat > /tmp/bootstrap-server.sh << 'BOOTEOF'\n{bootstrap}\nBOOTEOF\nchmod +x /tmp/bootstrap-server.sh && bash /tmp/bootstrap-server.sh")

        with tempfile.TemporaryDirectory() as td:
            zip_path = Path(td) / "zhubo-analysis.zip"
            env_path = Path(td) / "server.env"
            build_zip(zip_path)
            env_path.write_text(build_env_content(), encoding="utf-8")

            run(client, f"mkdir -p {DEPLOY_DIR}/logs /tmp/zhubo-upload")
            sftp_put(client, zip_path, "/tmp/zhubo-upload/zhubo-analysis.zip")
            sftp_put(client, env_path, "/tmp/zhubo-upload/server.env")

            db = ROOT / "apps/server/data/app.db"
            if db.exists():
                sftp_put(client, db, "/tmp/zhubo-upload/app.db")

        run(
            client,
            f"""
set -e
DEPLOY_DIR={DEPLOY_DIR}
if [ -d "$DEPLOY_DIR" ] && [ "$(ls -A "$DEPLOY_DIR" 2>/dev/null | wc -l)" -gt 0 ]; then
  ts=$(date +%Y%m%d-%H%M%S)
  cp -a "$DEPLOY_DIR" "/www/wwwroot/zhubo-analysis-backup-$ts"
  echo "$ts" > /www/wwwroot/.zhubo-analysis-last-backup-name
  echo "/www/wwwroot/zhubo-analysis-backup-$ts" > /www/wwwroot/.zhubo-analysis-last-backup
fi
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
unzip -q /tmp/zhubo-upload/zhubo-analysis.zip -d "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/apps/server/data"
cp /tmp/zhubo-upload/server.env "$DEPLOY_DIR/apps/server/.env"
if [ -f /tmp/zhubo-upload/app.db ]; then cp /tmp/zhubo-upload/app.db "$DEPLOY_DIR/apps/server/data/app.db"; fi
chmod +x "$DEPLOY_DIR"/deploy/aliyun/*.sh "$DEPLOY_DIR"/scripts/install-xhs-signer.sh 2>/dev/null || true
""",
        )

        code = run(client, f"cd {DEPLOY_DIR} && USE_GIT=0 SKIP_BACKUP=1 bash deploy/aliyun/deploy.sh", timeout=3600)
        if code != 0:
            sys.exit(code)

        if os.environ.get("DEPLOY_NGINX", "0") == "1":
            nginx_conf = (ROOT / "deploy/aliyun/nginx-zhubo-analysis.conf.example").read_text(encoding="utf-8")
            run(
                client,
                f"cat > /etc/nginx/conf.d/zhubo-analysis.conf << 'NGXEOF'\n{nginx_conf}\nNGXEOF\nnginx -t && systemctl reload nginx",
            )

        run(client, "export NVM_DIR=/root/.nvm && . /root/.nvm/nvm.sh && pm2 save 2>/dev/null || pm2 save")

        run(client, "curl -i --max-time 10 http://127.0.0.1:4723/api/health")
        run(client, "curl -i --max-time 10 http://127.0.0.1/api/health")
        run(client, "curl -i --max-time 15 http://8.137.126.18/api/health")
        run(client, "export NVM_DIR=/root/.nvm && . /root/.nvm/nvm.sh && pm2 status")

    finally:
        client.close()


if __name__ == "__main__":
    main()
