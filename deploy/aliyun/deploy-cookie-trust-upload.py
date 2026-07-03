#!/usr/bin/env python3
"""Deploy: trust uploaded cookies, no auto probe; manual test only."""
from pathlib import Path
import paramiko

ROOT = Path(__file__).resolve().parents[2]
pw = next(
    l.split("=", 1)[1].strip().strip('"').strip("'")
    for l in (ROOT / "secrets" / "deploy.env").read_text(encoding="utf-8").splitlines()
    if l.startswith("SSH_PASS=")
)
DEPLOY = "/www/wwwroot/zhubo-analysis"
files = [
    "apps/web/src/lib/live-account.ts",
    "apps/web/src/components/config/LiveAccountCookiePanel.tsx",
    "apps/web/src/components/board/CookieHealthWatcher.tsx",
    "apps/server/src/utils/cookie-sync-status.util.ts",
    "apps/server/src/services/shop-cookie-health.service.ts",
    "apps/server/src/services/live-account.service.ts",
    "apps/server/src/services/official-shop-account.service.ts",
    "apps/server/src/routes/settings.routes.ts",
    "apps/server/src/routes/shop-cookies.routes.ts",
]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("8.137.126.18", username="root", password=pw, timeout=60)
sftp = c.open_sftp()
for rel in files:
    sftp.put(str(ROOT / rel), f"{DEPLOY}/{rel}")
    print("uploaded", rel)
sftp.close()
cmd = (
    f"cd {DEPLOY} && npm run build -w @live/server "
    f"&& export VITE_BASE_PATH=/zhubofenxi/ && npm run build -w @live/web "
    f"&& pm2 restart zhubo-analysis && sleep 3 && curl -s http://127.0.0.1:4723/api/health"
)
_, o, e = c.exec_command(cmd, timeout=600)
out = (o.read() + e.read()).decode("utf-8", "replace")
(ROOT / "deploy/aliyun/cookie-trust-upload-deploy.txt").write_text(out[-4000:], encoding="utf-8")
print("done")
c.close()
