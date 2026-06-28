#!/usr/bin/env python3
"""Apply multi-domain nginx + CORS on server. Requires SSH_PASS."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
HOST = os.environ.get("DEPLOY_HOST", "8.137.126.18")
PASSWORD = os.environ.get("SSH_PASS", "")
ORIGINS = "http://8.137.126.18,http://xiangyuzhubao.xyz,http://www.xiangyuzhubao.xyz"


def safe_print(text: str) -> None:
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> int:
    safe_print(f"\n>>> {cmd[:120]}...")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        safe_print(out.rstrip())
    if err.strip():
        safe_print(err.rstrip())
    return code


def main() -> None:
    if not PASSWORD:
        print("Missing SSH_PASS", file=sys.stderr)
        sys.exit(1)
    nginx_conf = (ROOT / "deploy/aliyun/nginx-zhubo-analysis.conf.example").read_text(encoding="utf-8")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    try:
        run(
            client,
            f"cat > /etc/aa_nginx/conf.d/zhubo-analysis.conf << 'NGXEOF'\n{nginx_conf}\nNGXEOF",
        )
        run(client, "/usr/sbin/aa_nginx -t")
        run(client, "systemctl reload aa_nginx 2>/dev/null || /usr/sbin/aa_nginx -s reload")
        env_path = "/www/wwwroot/zhubo-analysis/apps/server/.env"
        run(
            client,
            f"""python3 << 'PYEOF'
from pathlib import Path
p = Path("{env_path}")
lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
origins = "{ORIGINS}"
keys = {{"CORS_ORIGIN": origins, "WEB_ORIGIN": origins}}
out, seen = [], set()
for line in lines:
    if "=" in line and not line.strip().startswith("#"):
        k = line.split("=", 1)[0].strip()
        if k in keys:
            out.append(f"{{k}}={{keys[k]}}")
            seen.add(k)
            continue
    out.append(line)
for k, v in keys.items():
    if k not in seen:
        out.append(f"{{k}}={{v}}")
p.write_text("\\n".join(out) + "\\n", encoding="utf-8")
print("updated .env origins (values hidden)")
PYEOF""",
        )
        run(client, "pm2 restart zhubo-analysis")
        run(client, "sleep 6")
        for url in [
            "http://127.0.0.1:4723/api/health",
            "http://8.137.126.18/api/health",
            "http://xiangyuzhubao.xyz/api/health",
            "http://www.xiangyuzhubao.xyz/api/health",
        ]:
            run(client, f'code=$(curl -s -o /tmp/h.json -w "%{{http_code}}" --max-time 15 "{url}"); echo "{url} -> $code"; head -c 80 /tmp/h.json 2>/dev/null; echo')
        run(
            client,
            'curl -s -D - -o /dev/null -H "Origin: http://xiangyuzhubao.xyz" http://127.0.0.1:4723/api/health | grep -i access-control',
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
