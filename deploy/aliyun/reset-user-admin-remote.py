#!/usr/bin/env python3
"""Reset user password + super_admin on remote server via sqlite3. Requires SSH_PASS."""
from __future__ import annotations

import os
import subprocess
import sys
import uuid

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "8.137.126.18")
PASSWORD = os.environ.get("SSH_PASS", "")
DB = "/www/wwwroot/zhubo-analysis/apps/server/data/app.db"
USERNAME = sys.argv[1] if len(sys.argv) > 1 else "fanfan"
NEW_PASSWORD = sys.argv[2] if len(sys.argv) > 2 else "fanfan9724"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def run(client: paramiko.SSHClient, cmd: str) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    return stdout.channel.recv_exit_status(), out, err


def hash_password(plain: str) -> str:
    js = (
        "const bcrypt=require('bcryptjs');"
        f"bcrypt.hash({plain!r},12).then(h=>{{console.log(h);process.exit(0);}})"
        ".catch(e=>{console.error(e);process.exit(1);});"
    )
    proc = subprocess.run(
        ["node", "-e", js],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "bcrypt hash failed")
    return proc.stdout.strip()


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def main() -> None:
    if not PASSWORD:
        print("Missing SSH_PASS", file=sys.stderr)
        sys.exit(1)
    if len(NEW_PASSWORD) < 8:
        print("Password must be at least 8 characters", file=sys.stderr)
        sys.exit(1)

    password_hash = hash_password(NEW_PASSWORD)
    user_sql = NEW_PASSWORD.replace("'", "''")
    hash_sql = password_hash.replace("'", "''")
    user_id = sql_escape(str(uuid.uuid4()))
    sql_path = f"/tmp/reset-user-{USERNAME}.sql"

    sql = f"""
UPDATE User SET
  role = 'super_admin',
  enabled = 1,
  passwordHash = '{hash_sql}',
  managedPassword = '{user_sql}',
  mustChangePassword = 0,
  passwordChangedAt = datetime('now'),
  updatedAt = datetime('now')
WHERE username = '{sql_escape(USERNAME)}';
INSERT INTO User (id, username, passwordHash, managedPassword, role, enabled, mustChangePassword, passwordChangedAt, createdAt, updatedAt)
SELECT '{user_id}', '{sql_escape(USERNAME)}', '{hash_sql}', '{user_sql}', 'super_admin', 1, 0, datetime('now'), datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM User WHERE username = '{sql_escape(USERNAME)}');
DELETE FROM Session WHERE userId IN (SELECT id FROM User WHERE username = '{sql_escape(USERNAME)}');
"""

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", password=PASSWORD, timeout=60)
    try:
        print(f">>> reset {USERNAME} -> super_admin")
        sftp = client.open_sftp()
        with sftp.file(sql_path, "w") as f:
            f.write(sql.strip())
        sftp.close()

        code, out, err = run(client, f"sqlite3 {DB} < {sql_path}")
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if code != 0:
            sys.exit(code)
        print("[reset] password and role applied via SQL file")

        list_cmd = f"sqlite3 {DB} \"SELECT username, role, enabled, substr(passwordHash,1,7), managedPassword FROM User WHERE username='{sql_escape(USERNAME)}';\""
        _, out, _ = run(client, list_cmd)
        print(out.rstrip())
    finally:
        client.close()


if __name__ == "__main__":
    main()
