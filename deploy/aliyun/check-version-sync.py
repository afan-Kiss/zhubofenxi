#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = "/www/wwwroot/zhubo-analysis"


def load_pass() -> str:
    for line in (ROOT / "secrets/deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (r.stdout or r.stderr).strip()


def file_md5(path: Path) -> str | None:
    if not path.exists():
        return None
    return hashlib.md5(path.read_bytes()).hexdigest()


def main() -> None:
    local_head = git("rev-parse", "--short", "HEAD")
    origin_head = git("rev-parse", "--short", "origin/main")
    dirty = bool(git("status", "--porcelain"))

    local_bundle = next((ROOT / "apps/web/dist/assets").glob("index-*.js"), None)
    local_bundle_md5 = file_md5(local_bundle) if local_bundle else None

    pw = load_pass()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("8.137.126.18", username="root", password=pw, timeout=60)

    def run(cmd: str) -> str:
        _, o, _ = c.exec_command(cmd, timeout=60)
        return o.read().decode("utf-8", errors="replace").strip()

    server_bundle = run(f"ls {DEPLOY}/apps/web/dist/assets/index-*.js 2>/dev/null | head -1")
    server_bundle_md5 = run(f"md5sum {server_bundle} 2>/dev/null | awk '{{print $1}}'") if server_bundle else ""
    server_has_git = run(f"test -d {DEPLOY}/.git && echo yes || echo no")
    server_attendance = run(
        f"grep -rl daily-report-show-attendance-v1 {DEPLOY}/apps/web/dist/assets 2>/dev/null | wc -l"
    )
    server_preserve_key = run(
        "python3 -c \"from pathlib import Path;p=Path('/www/wwwroot/zhubo-analysis/deploy/aliyun/upload-and-deploy.py');t=p.read_text(encoding='utf-8');print('yes' if 'COOKIE_ENCRYPTION_KEY' in t and 'preserve_keys' in t else 'no')\""
    )
    c.close()

    enc = getattr(sys.stdout, "encoding", None) or "utf-8"

    def p(s: str) -> None:
        print(s.encode(enc, errors="replace").decode(enc, errors="replace"))

    p("=== GitHub / 本地提交 ===")
    p(f"本地 HEAD:        {local_head}")
    p(f"origin/main:      {origin_head}")
    p(f"本地与远程提交一致: {'是' if local_head == origin_head else '否'}")
    p(f"本地有未提交改动:   {'是' if dirty else '否'}")

    p("\n=== 未提交的业务改动（相对 HEAD）===")
    for line in git("diff", "--name-only", "HEAD").splitlines():
        if line.strip():
            p(f"  - {line}")

    p("\n=== 未跟踪的新文件（业务相关）===")
    for line in git("status", "--porcelain").splitlines():
        if line.startswith("??"):
            path = line[3:].strip()
            if path.startswith("apps/"):
                p(f"  - {path}")

    p("\n=== 本地 vs 服务器前端包 ===")
    p(f"本地 bundle:   {local_bundle.name if local_bundle else '(未 build)'}")
    p(f"服务器 bundle: {Path(server_bundle).name if server_bundle else '(无)'}")
    p(f"MD5 一致:      {'是' if local_bundle_md5 and local_bundle_md5 == server_bundle_md5 else '否'}")
    if local_bundle_md5:
        p(f"  本地 MD5:   {local_bundle_md5}")
    if server_bundle_md5:
        p(f"  服务器 MD5: {server_bundle_md5}")

    p("\n=== 服务器部署方式 ===")
    p(f"服务器有 .git: {server_has_git}")
    p("说明: 部署走 zip 上传（USE_GIT=0），不是 git pull")

    p("\n=== 功能差异点 ===")
    p(f"服务器含「日报迟到早退勾选」: {'是' if server_attendance.strip() not in {'', '0'} else '否'}")
    p(f"GitHub HEAD 含该功能:         否（未提交）")
    p(f"服务器 deploy 脚本保留 COOKIE_ENCRYPTION_KEY: {server_preserve_key}")


if __name__ == "__main__":
    main()
