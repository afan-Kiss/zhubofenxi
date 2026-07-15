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
HOST = os.environ.get("DEPLOY_HOST", "47.108.21.50")
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
DB_BACKUP_DIR = "/www/backups/zhubo-analysis-db"
# 有订单的库快照只留最近几份，避免撑盘
MIN_DB_BACKUP_KEEP_WITH_ORDERS = 5
# 全量目录备份（已改为轻量、排除 node_modules）只留最近几份
MIN_FULL_DIR_BACKUP_KEEP = 2


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
        "WEB_ORIGIN": "http://47.108.21.50,http://47.108.21.50/zhubofenxi,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz",
        "CORS_ORIGIN": "http://47.108.21.50,http://47.108.21.50/zhubofenxi,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz",
        "WEB_BASE_PATH": "/zhubofenxi",
        "COOKIE_SECURE": "false",
        "AUTH_MODE": "session",
        "AUTH_ALLOW_REGISTER": "true",
        "XHS_SIGNER_ENABLED": "true",
        "XHS_SIGN_PYTHON": "/usr/bin/python3",
        "XHS_SIGNER_PYTHON": "/usr/bin/python3",
        "XHS_SIGNER_SCRIPT": "/www/wwwroot/zhubo-analysis/apps/server/tools/xhs_signer/signer.py",
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
DB_BACKUP_DIR={DB_BACKUP_DIR}
MIN_DB_BACKUP_KEEP_WITH_ORDERS={MIN_DB_BACKUP_KEEP_WITH_ORDERS}
MIN_FULL_DIR_BACKUP_KEEP={MIN_FULL_DIR_BACKUP_KEEP}
rm -f /tmp/zhubo-upload/app.db "$PRESERVE_DB" "$PRESERVE_ENV"
rm -rf "$PRESERVE_REPORT_IMAGES"
mkdir -p "$DB_BACKUP_DIR"

count_table() {{
  local db_file="$1"
  local table="$2"
  if [ ! -f "$db_file" ]; then
    echo 0
    return
  fi
  sqlite3 "$db_file" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo 0
}}

count_orders() {{
  count_table "$1" "XhsRawOrder"
}}

# SQLite WAL 下裸 cp app.db 会丢最近未 checkpoint 的写入（曾丢 OfflineDeal）。
# 优先用 sqlite3 .backup 做一致性快照；失败再回退到 cp db+wal+shm。
safe_sqlite_snapshot() {{
  local src="$1"
  local dest="$2"
  rm -f "$dest" "$dest-wal" "$dest-shm"
  if command -v sqlite3 >/dev/null 2>&1; then
    if sqlite3 "$src" ".backup '$dest'" 2>/dev/null; then
      if [ -f "$dest" ] && [ "$(stat -c '%s' "$dest" 2>/dev/null || echo 0)" -gt 0 ]; then
        echo "safe_sqlite_snapshot: used .backup -> $dest"
        return 0
      fi
    fi
  fi
  cp -a "$src" "$dest"
  [ -f "$src-wal" ] && cp -a "$src-wal" "$dest-wal" || true
  [ -f "$src-shm" ] && cp -a "$src-shm" "$dest-shm" || true
  echo "safe_sqlite_snapshot: fallback cp db(+wal+shm) -> $dest"
}}

collect_db_stats() {{
  local db_file="$1"
  if [ ! -f "$db_file" ]; then
    echo "orders=0 users=0 creds=0 jobs=0 offline=0 size=0"
    return
  fi
  local orders users creds jobs offline size
  orders=$(count_orders "$db_file")
  users=$(count_table "$db_file" "User")
  creds=$(count_table "$db_file" "PlatformCredential")
  jobs=$(count_table "$db_file" "XhsSyncJob")
  offline=$(count_table "$db_file" "OfflineDeal")
  size=$(stat -c '%s' "$db_file" 2>/dev/null || echo 0)
  echo "orders=$orders users=$users creds=$creds jobs=$jobs offline=$offline size=$size"
}}

backup_production_db_with_stats() {{
  local db_file="$1"
  local stats="$2"
  local ts orders users creds offline backup_name
  ts=$(date +%Y%m%d-%H%M%S)
  orders=$(echo "$stats" | sed -n 's/.*orders=\\([0-9]*\\).*/\\1/p')
  users=$(echo "$stats" | sed -n 's/.*users=\\([0-9]*\\).*/\\1/p')
  creds=$(echo "$stats" | sed -n 's/.*creds=\\([0-9]*\\).*/\\1/p')
  offline=$(echo "$stats" | sed -n 's/.*offline=\\([0-9]*\\).*/\\1/p')
  backup_name="app.db.${{ts}}.orders-${{orders}}.users-${{users}}.cookies-${{creds}}.offline-${{offline:-0}}.db"
  safe_sqlite_snapshot "$db_file" "$DB_BACKUP_DIR/$backup_name"
  echo "Backed up production app.db -> $DB_BACKUP_DIR/$backup_name"
}}

prune_db_backups() {{
  local keep=0
  # 清理 .backup 产生的旁路文件与空订单快照
  rm -f "$DB_BACKUP_DIR"/*.db-wal "$DB_BACKUP_DIR"/*.db-shm 2>/dev/null || true
  for f in "$DB_BACKUP_DIR"/app.db.*.orders-0.*.db; do
    [ -f "$f" ] || continue
    rm -f "$f"
    echo "Pruned empty-orders backup: $f"
  done
  for f in $(ls -t "$DB_BACKUP_DIR"/app.db.*.orders-*.db 2>/dev/null); do
    local orders
    orders=$(echo "$f" | sed -n 's/.*orders-\\([0-9]*\\).*/\\1/p')
    if [ "${{orders:-0}}" -gt 0 ]; then
      keep=$((keep + 1))
      if [ "$keep" -gt "$MIN_DB_BACKUP_KEEP_WITH_ORDERS" ]; then
        rm -f "$f"
        echo "Pruned old non-empty backup: $f"
      fi
    else
      rm -f "$f"
      echo "Pruned empty-orders backup: $f"
    fi
  done
}}

prune_full_dir_backups() {{
  local keep=0
  for d in $(ls -dt /www/wwwroot/zhubo-analysis-backup-* 2>/dev/null); do
    keep=$((keep + 1))
    if [ "$keep" -gt "$MIN_FULL_DIR_BACKUP_KEEP" ]; then
      rm -rf "$d"
      echo "Pruned old full-dir backup: $d"
    fi
  done
}}

PRE_DEPLOY_STATS=""
if [ -f "$DEPLOY_DIR/apps/server/data/app.db" ]; then
  PRE_DEPLOY_STATS=$(collect_db_stats "$DEPLOY_DIR/apps/server/data/app.db")
  echo "Pre-deploy db stats: $PRE_DEPLOY_STATS"
  safe_sqlite_snapshot "$DEPLOY_DIR/apps/server/data/app.db" "$PRESERVE_DB"
  backup_production_db_with_stats "$DEPLOY_DIR/apps/server/data/app.db" "$PRE_DEPLOY_STATS"
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
  # 轻量代码备份：排除 node_modules 与库文件（库已单独 .backup）
  mkdir -p "/www/wwwroot/zhubo-analysis-backup-$ts"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude 'node_modules' \
      --exclude '**/node_modules' \
      --exclude 'apps/server/data/*.db' \
      --exclude 'apps/server/data/*.db-wal' \
      --exclude 'apps/server/data/*.db-shm' \
      --exclude 'apps/server/data/good-review-image-cache' \
      --exclude 'apps/server/data/downloads' \
      --exclude 'apps/server/data/board-snapshots' \
      "$DEPLOY_DIR/" "/www/wwwroot/zhubo-analysis-backup-$ts/"
  else
    cp -a "$DEPLOY_DIR" "/www/wwwroot/zhubo-analysis-backup-$ts.tmp"
    rm -rf "/www/wwwroot/zhubo-analysis-backup-$ts.tmp/node_modules" \
      "/www/wwwroot/zhubo-analysis-backup-$ts.tmp/apps/web/node_modules" \
      "/www/wwwroot/zhubo-analysis-backup-$ts.tmp/apps/server/node_modules" 2>/dev/null || true
    rm -f "/www/wwwroot/zhubo-analysis-backup-$ts.tmp/apps/server/data/"*.db \
      "/www/wwwroot/zhubo-analysis-backup-$ts.tmp/apps/server/data/"*.db-wal \
      "/www/wwwroot/zhubo-analysis-backup-$ts.tmp/apps/server/data/"*.db-shm 2>/dev/null || true
    rm -rf "/www/wwwroot/zhubo-analysis-backup-$ts"
    mv "/www/wwwroot/zhubo-analysis-backup-$ts.tmp" "/www/wwwroot/zhubo-analysis-backup-$ts"
  fi
  echo "$ts" > /www/wwwroot/.zhubo-analysis-last-backup-name
  echo "/www/wwwroot/zhubo-analysis-backup-$ts" > /www/wwwroot/.zhubo-analysis-last-backup
  prune_full_dir_backups
  echo "Created lightweight code backup (no node_modules/db): zhubo-analysis-backup-$ts"
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
    "XHS_SIGN_PYTHON",
    "XHS_SIGNER_PYTHON",
    "XHS_SIGNER_SCRIPT",
    "SF_PARTNER_ID",
    "SF_CHECK_WORD",
    "SF_CHECK_WORD_SANDBOX",
    "SF_MONTHLY_CARD",
    "SF_PHONE_LAST4",
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
  PRESERVE_OFFLINE=0
  if [ -f "$PRESERVE_DB" ]; then
    PRESERVE_ORDERS=$(count_orders "$PRESERVE_DB")
    PRESERVE_SIZE=$(stat -c '%s' "$PRESERVE_DB" 2>/dev/null || echo 0)
    PRESERVE_OFFLINE=$(count_table "$PRESERVE_DB" "OfflineDeal")
  fi
  RESTORE_ORDERS=$(count_orders "$RESTORE_SOURCE")
  RESTORE_SIZE=$(stat -c '%s' "$RESTORE_SOURCE" 2>/dev/null || echo 0)
  RESTORE_OFFLINE=$(count_table "$RESTORE_SOURCE" "OfflineDeal")
  echo "Database restore check: preserve_orders=$PRESERVE_ORDERS preserve_size=$PRESERVE_SIZE preserve_offline=$PRESERVE_OFFLINE restore_orders=$RESTORE_ORDERS restore_size=$RESTORE_SIZE restore_offline=$RESTORE_OFFLINE source=$RESTORE_SOURCE"

  if [ "$PRESERVE_ORDERS" -gt 0 ] && [ "$RESTORE_ORDERS" -eq 0 ]; then
    echo "[deploy][FAIL] 拒绝用空库覆盖生产库: 线上原有 XhsRawOrder=$PRESERVE_ORDERS，恢复目标 XhsRawOrder=0"
    exit 1
  fi
  if [ "$PRESERVE_ORDERS" -gt 0 ] && [ "$PRESERVE_SIZE" -lt "$MIN_PRESERVE_DB_BYTES" ]; then
    echo "[deploy][FAIL] 拒绝用空库覆盖生产库: preserve 仅 ${{PRESERVE_SIZE}}B (<5MB) 但线上原有 XhsRawOrder=$PRESERVE_ORDERS"
    exit 1
  fi
  if [ "$PRESERVE_OFFLINE" -gt 0 ] && [ "$RESTORE_OFFLINE" -eq 0 ]; then
    echo "[deploy][FAIL] 拒绝覆盖：线上 OfflineDeal=$PRESERVE_OFFLINE，恢复目标 OfflineDeal=0（疑似 WAL 裸拷丢失）"
    exit 1
  fi

  # 恢复时也用一致快照写入目标（若源已是 .backup 产物则直接 cp）
  rm -f "$DEPLOY_DIR/apps/server/data/app.db" "$DEPLOY_DIR/apps/server/data/app.db-wal" "$DEPLOY_DIR/apps/server/data/app.db-shm"
  cp -a "$RESTORE_SOURCE" "$DEPLOY_DIR/apps/server/data/app.db"
  [ -f "$RESTORE_SOURCE-wal" ] && cp -a "$RESTORE_SOURCE-wal" "$DEPLOY_DIR/apps/server/data/app.db-wal" || true
  [ -f "$RESTORE_SOURCE-shm" ] && cp -a "$RESTORE_SOURCE-shm" "$DEPLOY_DIR/apps/server/data/app.db-shm" || true
  if [ "$RESTORE_SOURCE" = "$FORCED_LOCAL_DB" ]; then
    echo "Restored app.db from explicit local upload (DEPLOY_UPLOAD_LOCAL_DB=1 with overwrite confirmation)"
  else
    echo "Restored preserved production app.db after deploy"
  fi
  rm -f "$FORCED_LOCAL_DB"

  POST_DEPLOY_STATS=$(collect_db_stats "$DEPLOY_DIR/apps/server/data/app.db")
  echo "Post-deploy db stats: $POST_DEPLOY_STATS"
  PRE_ORDERS=$(echo "$PRE_DEPLOY_STATS" | sed -n 's/.*orders=\\([0-9]*\\).*/\\1/p')
  PRE_USERS=$(echo "$PRE_DEPLOY_STATS" | sed -n 's/.*users=\\([0-9]*\\).*/\\1/p')
  PRE_CREDS=$(echo "$PRE_DEPLOY_STATS" | sed -n 's/.*creds=\\([0-9]*\\).*/\\1/p')
  PRE_OFFLINE=$(echo "$PRE_DEPLOY_STATS" | sed -n 's/.*offline=\\([0-9]*\\).*/\\1/p')
  PRE_SIZE=$(echo "$PRE_DEPLOY_STATS" | sed -n 's/.*size=\\([0-9]*\\).*/\\1/p')
  POST_ORDERS=$(echo "$POST_DEPLOY_STATS" | sed -n 's/.*orders=\\([0-9]*\\).*/\\1/p')
  POST_USERS=$(echo "$POST_DEPLOY_STATS" | sed -n 's/.*users=\\([0-9]*\\).*/\\1/p')
  POST_CREDS=$(echo "$POST_DEPLOY_STATS" | sed -n 's/.*creds=\\([0-9]*\\).*/\\1/p')
  POST_OFFLINE=$(echo "$POST_DEPLOY_STATS" | sed -n 's/.*offline=\\([0-9]*\\).*/\\1/p')
  POST_SIZE=$(echo "$POST_DEPLOY_STATS" | sed -n 's/.*size=\\([0-9]*\\).*/\\1/p')
  if [ -n "$PRE_OFFLINE" ] && [ -n "$POST_OFFLINE" ] && [ "$PRE_OFFLINE" -gt 0 ] && [ "$POST_OFFLINE" -lt "$PRE_OFFLINE" ]; then
    echo "[deploy][FAIL] OfflineDeal 数量异常下降（${{PRE_OFFLINE}} -> ${{POST_OFFLINE}}）"
    exit 1
  fi

  if [ "${{PRE_ORDERS:-0}}" -gt 0 ] && [ "${{POST_ORDERS:-0}}" -eq 0 ]; then
    echo "[deploy][FAIL] 拒绝部署：数据库疑似被空库覆盖（XhsRawOrder ${{PRE_ORDERS}} -> 0）"
    exit 1
  fi
  if [ "${{PRE_USERS:-0}}" -gt 0 ] && [ "${{POST_USERS:-0}}" -eq 0 ]; then
    echo "[deploy][FAIL] 拒绝部署：User 被清空（${{PRE_USERS}} -> 0）"
    exit 1
  fi
  if [ "${{PRE_CREDS:-0}}" -gt 0 ] && [ "${{POST_CREDS:-0}}" -eq 0 ]; then
    echo "[deploy][FAIL] 拒绝部署：PlatformCredential 被清空（${{PRE_CREDS}} -> 0）"
    exit 1
  fi
  if [ "${{PRE_SIZE:-0}}" -gt 5242880 ] && [ "${{POST_SIZE:-0}}" -lt 1048576 ]; then
    echo "[deploy][FAIL] 拒绝部署：app.db 体积异常缩小（${{PRE_SIZE}}B -> ${{POST_SIZE}}B）"
    exit 1
  fi
  prune_db_backups
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
        run(client, "curl -i --max-time 15 http://47.108.21.50/api/health")
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
