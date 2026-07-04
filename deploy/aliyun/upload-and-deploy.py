#!/usr/bin/env python3
"""Upload project bundle and run deploy on Aliyun server. Requires SSH_PASS env."""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
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
DB_FILE_SUFFIXES = (".db", ".db-shm", ".db-wal", ".sqlite", ".sqlite3")
SERVER_DATA_DIR_PREFIX = "apps/server/data/"
DB_OVERWRITE_CONFIRM = "YES_I_KNOW_THIS_WILL_OVERWRITE_PRODUCTION_DB"
FORCED_LOCAL_DB_REMOTE = "/tmp/zhubo-upload/forced-local-app.db"
MIN_PRESERVE_DB_BYTES = 5 * 1024 * 1024


def load_ssh_pass() -> str:
    for env_path in [
        ROOT / "secrets" / "deploy.env",
        Path(r"e:\我的软件源码\总控台") / ".env",
        ROOT / ".env",
    ]:
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("SSH_PASS="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val
    if os.environ.get("SSH_PASS", "").strip():
        return os.environ["SSH_PASS"].strip()
    return ""


def connect() -> paramiko.SSHClient:
    password = load_ssh_pass()
    if not password:
        print("Missing SSH_PASS", file=sys.stderr)
        sys.exit(1)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=password, timeout=60)
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
    if rel_norm.startswith(SERVER_DATA_DIR_PREFIX):
        return True
    lower = rel_norm.lower()
    if lower.endswith(DB_FILE_SUFFIXES):
        return True
    if rel_norm.endswith("tsconfig.tsbuildinfo"):
        return True
    if any(rel_norm.endswith(s) for s in SKIP_FILE_SUFFIX):
        return True
    return False


def sqlite_count(path: Path, table: str) -> int | None:
    if not path.is_file():
        return None
    try:
        r = subprocess.run(
            ["sqlite3", str(path), f"SELECT COUNT(*) FROM {table};"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if r.returncode != 0:
            return None
        return int((r.stdout or "0").strip() or "0")
    except Exception:
        return None


def resolve_forced_local_db_upload() -> Path | None:
    """Explicit local db upload is opt-in and requires a second confirmation."""
    if os.environ.get("DEPLOY_UPLOAD_LOCAL_DB", "0") != "1":
        return None
    confirm = os.environ.get("DEPLOY_ALLOW_DB_OVERWRITE", "").strip()
    if confirm != DB_OVERWRITE_CONFIRM:
        print(
            "DEPLOY_UPLOAD_LOCAL_DB=1 requires "
            f"DEPLOY_ALLOW_DB_OVERWRITE={DB_OVERWRITE_CONFIRM}",
            file=sys.stderr,
        )
        sys.exit(1)
    db = ROOT / "apps/server/data/app.db"
    if not db.is_file():
        print(f"Local database not found: {db}", file=sys.stderr)
        sys.exit(1)
    orders = sqlite_count(db, "XhsRawOrder")
    print(
        f"Forced local db upload enabled: {db} "
        f"(size={db.stat().st_size}, XhsRawOrder={orders if orders is not None else 'unknown'})"
    )
    return db


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


def resolve_deploy_git_commit() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        commit = (r.stdout or "").strip()
        if r.returncode == 0 and commit:
            return commit
    except Exception:
        pass
    return "unknown"


def resolve_app_version() -> str:
    try:
        pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        return str(pkg.get("version") or "0.2.0")
    except Exception:
        return "0.2.0"


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
        "WEB_ORIGIN": "http://8.137.126.18,http://8.137.126.18/zhubofenxi,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz",
        "CORS_ORIGIN": "http://8.137.126.18,http://8.137.126.18/zhubofenxi,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz",
        "WEB_BASE_PATH": "/zhubofenxi",
        "COOKIE_SECURE": "false",
        "AUTH_MODE": "session",
        "AUTH_ALLOW_REGISTER": "true",
        "XHS_SIGNER_ENABLED": "true",
        "XHS_SIGNER_PYTHON": "tools/xhs_signer/.venv/bin/python",
        "DATABASE_URL": "file:../data/app.db",
        "GIT_COMMIT": resolve_deploy_git_commit(),
        "APP_VERSION": resolve_app_version(),
    }

    if not any(l.startswith("SESSION_SECRET=") and "请替换" not in l for l in lines):
        overrides["SESSION_SECRET"] = secrets.token_urlsafe(48)
    # 仅用于本地/首次安装模板；生产部署会从 preserve-server.env 恢复真实密钥
    if not any(
        l.startswith("COOKIE_ENCRYPTION_KEY=")
        and "请替换" not in l
        and len(l.split("=", 1)[-1].strip().strip('"').strip("'")) >= 32
        for l in lines
        if l.startswith("COOKIE_ENCRYPTION_KEY=")
    ):
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

            forced_local_db = resolve_forced_local_db_upload()
            if forced_local_db is not None:
                sftp_put(client, forced_local_db, FORCED_LOCAL_DB_REMOTE)

        run(
            client,
            f"""
set -e
DEPLOY_DIR={DEPLOY_DIR}
PRESERVE_DB=/tmp/zhubo-upload/preserve-app.db
PRESERVE_ENV=/tmp/zhubo-upload/preserve-server.env
PRESERVE_REPORT_IMAGES=/tmp/zhubo-upload/preserve-daily-report-images
FORCED_LOCAL_DB={FORCED_LOCAL_DB_REMOTE}
MIN_PRESERVE_DB_BYTES={MIN_PRESERVE_DB_BYTES}
rm -f /tmp/zhubo-upload/app.db "$PRESERVE_DB" "$PRESERVE_ENV"
rm -rf "$PRESERVE_REPORT_IMAGES"

count_orders() {{
  local db_file="$1"
  if [ ! -f "$db_file" ]; then
    echo 0
    return
  fi
  sqlite3 "$db_file" "SELECT COUNT(*) FROM XhsRawOrder;" 2>/dev/null || echo 0
}}

if [ -f "$DEPLOY_DIR/apps/server/data/app.db" ]; then
  cp -a "$DEPLOY_DIR/apps/server/data/app.db" "$PRESERVE_DB"
  echo "Preserved production app.db before deploy"
fi
if [ -f "$DEPLOY_DIR/apps/server/.env" ]; then
  cp -a "$DEPLOY_DIR/apps/server/.env" "$PRESERVE_ENV"
  echo "Preserved production apps/server/.env before deploy"
fi
if [ -d "$DEPLOY_DIR/apps/server/data/daily-report-images" ]; then
  cp -a "$DEPLOY_DIR/apps/server/data/daily-report-images" "$PRESERVE_REPORT_IMAGES"
  echo "Preserved production daily-report-images before deploy"
fi
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
if [ -f "$PRESERVE_ENV" ]; then
  python3 << 'PY'
from pathlib import Path

def load_env(path: Path):
    out = {{}}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out

preserve_keys = [
    "SESSION_SECRET",
    "COOKIE_ENCRYPTION_KEY",
    "CONTROL_SERVICE_TOKEN",
    "SHOP_COOKIE_UPLOAD_TOKEN",
]
target = Path("{DEPLOY_DIR}/apps/server/.env")
merged = load_env(target)
preserved = load_env(Path("/tmp/zhubo-upload/preserve-server.env"))
for key in preserve_keys:
    val = preserved.get(key, "").strip()
    if val and "请替换" not in val:
        merged[key] = val
lines = target.read_text(encoding="utf-8").splitlines()
out_lines = []
seen = set()
for line in lines:
    if "=" in line and not line.strip().startswith("#"):
        k = line.split("=", 1)[0].strip()
        if k in merged:
            out_lines.append(f"{{k}}={{merged[k]}}")
            seen.add(k)
            continue
    out_lines.append(line)
for key in preserve_keys:
    if key in merged and key not in seen:
        out_lines.append(f"{{key}}={{merged[key]}}")
target.write_text("\\n".join(out_lines) + "\\n", encoding="utf-8")
print("Restored production secrets in apps/server/.env:", ", ".join(k for k in preserve_keys if k in preserved))
PY
fi

RESTORE_SOURCE=""
if [ -f "$FORCED_LOCAL_DB" ]; then
  RESTORE_SOURCE="$FORCED_LOCAL_DB"
elif [ -f "$PRESERVE_DB" ]; then
  RESTORE_SOURCE="$PRESERVE_DB"
fi

if [ -n "$RESTORE_SOURCE" ]; then
  PRESERVE_ORDERS=0
  PRESERVE_SIZE=0
  if [ -f "$PRESERVE_DB" ]; then
    PRESERVE_ORDERS=$(count_orders "$PRESERVE_DB")
    PRESERVE_SIZE=$(stat -c '%s' "$PRESERVE_DB" 2>/dev/null || echo 0)
  fi
  RESTORE_ORDERS=$(count_orders "$RESTORE_SOURCE")
  RESTORE_SIZE=$(stat -c '%s' "$RESTORE_SOURCE" 2>/dev/null || echo 0)
  echo "Database restore check: preserve_orders=$PRESERVE_ORDERS preserve_size=$PRESERVE_SIZE restore_orders=$RESTORE_ORDERS restore_size=$RESTORE_SIZE source=$RESTORE_SOURCE"

  if [ "$PRESERVE_ORDERS" -gt 0 ] && [ "$RESTORE_ORDERS" -eq 0 ]; then
    echo "[deploy][FAIL] 拒绝用空库覆盖生产库: 线上原有 XhsRawOrder=$PRESERVE_ORDERS，恢复目标 XhsRawOrder=0"
    exit 1
  fi
  if [ "$PRESERVE_ORDERS" -gt 0 ] && [ "$PRESERVE_SIZE" -lt "$MIN_PRESERVE_DB_BYTES" ]; then
    echo "[deploy][FAIL] 拒绝用空库覆盖生产库: preserve 仅 ${{PRESERVE_SIZE}}B (<5MB) 但线上原有 XhsRawOrder=$PRESERVE_ORDERS"
    exit 1
  fi

  cp -a "$RESTORE_SOURCE" "$DEPLOY_DIR/apps/server/data/app.db"
  if [ "$RESTORE_SOURCE" = "$FORCED_LOCAL_DB" ]; then
    echo "Restored app.db from explicit local upload (DEPLOY_UPLOAD_LOCAL_DB=1 with overwrite confirmation)"
  else
    echo "Restored preserved production app.db after deploy"
  fi
  rm -f "$FORCED_LOCAL_DB"
fi
if [ -d "$PRESERVE_REPORT_IMAGES" ]; then
  cp -a "$PRESERVE_REPORT_IMAGES" "$DEPLOY_DIR/apps/server/data/daily-report-images"
  echo "Restored preserved daily-report-images after deploy"
fi
chmod +x "$DEPLOY_DIR"/deploy/aliyun/*.sh "$DEPLOY_DIR"/scripts/install-xhs-signer.sh 2>/dev/null || true
""",
        )

        code = run(
            client,
            f"cd {DEPLOY_DIR} && DEPLOY_GIT_COMMIT={resolve_deploy_git_commit()} USE_GIT=0 SKIP_BACKUP=1 bash deploy/aliyun/deploy.sh",
            timeout=3600,
        )
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
        run(
            client,
            f"cd {DEPLOY_DIR} && "
            'echo "=== post-deploy database counts ===" && '
            'sqlite3 apps/server/data/app.db "SELECT COUNT(*) AS XhsRawOrder FROM XhsRawOrder;" && '
            'sqlite3 apps/server/data/app.db "SELECT COUNT(*) AS XhsSyncJob FROM XhsSyncJob;"',
        )

    finally:
        client.close()


if __name__ == "__main__":
    main()
