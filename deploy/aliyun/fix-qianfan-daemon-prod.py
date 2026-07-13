#!/usr/bin/env python3
"""
修复生产 qianfan-protocol-daemon：
1. 确保 qianfan-shop-title-match.js 存在（缺失会导致 PM2 222+ 次崩溃重启）
2. PM2 内存上限 + Node 堆限制（1.6GB 小内存机）
3. 拉长 activity timeout，减少误重连 CPU 开销
4. 干净重启并验收 /api/health
"""
from __future__ import annotations

import json
import re
import textwrap
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
HOST = "47.108.21.50"
QIANFAN_DIR = "/opt/qianfan-protocol"
TITLE_MATCH_PATH = f"{QIANFAN_DIR}/src/protocol/qianfan-shop-title-match.js"
ECOSYSTEM_PATH = f"{QIANFAN_DIR}/ecosystem.config.cjs"

TITLE_MATCH_SOURCE = textwrap.dedent(
    """
    /**
     * 店铺名规范化与匹配（XY祥钰珠宝 vs 祥钰珠宝 必须严格区分）
     */
    const { normalizeProtocolShopTitle } = require('./qianfan-protocol-config');

    const SHOP_TITLE_ALIASES = {
      拾玉居: '拾玉居和田玉',
      拾玉居和田玉: '拾玉居和田玉',
      XY祥钰: 'XY祥钰珠宝',
      祥钰: '祥钰珠宝',
    };

    function normalizeShopTitleForMatch(title) {
      const t = String(title || '').trim();
      if (!t) return '';
      if (SHOP_TITLE_ALIASES[t]) return SHOP_TITLE_ALIASES[t];
      return t.replace(/-工作台\\s*$/, '').replace(/工作台\\s*$/, '').trim();
    }

    function canonicalShopTitle(title) {
      return normalizeProtocolShopTitle(normalizeShopTitleForMatch(title));
    }

    /** daemon / CDP：worker 与入站消息是否同店 */
    function shopTitlesMatch(configTitle, incomingTitle) {
      const a = canonicalShopTitle(configTitle);
      const b = canonicalShopTitle(incomingTitle);
      return Boolean(a && b && a === b);
    }

    /** tap / WS 路由：行 shopTitle 是否属于目标店 */
    function shopTitleMatches(rowTitle, shopTitle) {
      if (!shopTitle) return true;
      if (!rowTitle) return false;
      return shopTitlesMatch(rowTitle, shopTitle);
    }

    module.exports = {
      SHOP_TITLE_ALIASES,
      normalizeShopTitleForMatch,
      canonicalShopTitle,
      shopTitlesMatch,
      shopTitleMatches,
    };
    """
).strip() + "\n"


def load_pass() -> str:
    for line in (ROOT / "secrets" / "deploy.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("SSH_PASS="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing SSH_PASS")


def run(c, cmd: str, timeout: int = 120) -> tuple[int, str]:
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = (o.read() + e.read()).decode("utf-8", "replace").strip()
    code = o.channel.recv_exit_status()
    return code, out


def patch_ecosystem(content: str) -> str:
    patched = content

    if "max_memory_restart" not in patched:
        patched = patched.replace(
            "autorestart: true,\r\n      max_restarts: 100,",
            "autorestart: true,\r\n      max_memory_restart: '450M',\r\n      node_args: '--max-old-space-size=384',\r\n      max_restarts: 100,",
            1,
        )
        patched = patched.replace(
            "autorestart: true,\n      max_restarts: 100,",
            "autorestart: true,\n      max_memory_restart: '450M',\n      node_args: '--max-old-space-size=384',\n      max_restarts: 100,",
            1,
        )

    env_additions = {
        "QIANFAN_PROTOCOL_ACTIVITY_TIMEOUT_MS": "'300000'",
        "QIANFAN_PROTOCOL_HTTP_POLL_BACKUP_MS": "'120000'",
    }
    for key, val in env_additions.items():
        if key not in patched:
            patched = re.sub(
                r"(name: 'qianfan-protocol-daemon',[\s\S]*?env: \{)",
                rf"\1\n        {key}: {val},",
                patched,
                count=1,
            )
        else:
            patched = re.sub(
                rf"{key}: '[^']*'",
                f"{key}: {val}",
                patched,
                count=1,
            )

    return patched


def main() -> None:
    pw = load_pass()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=pw, timeout=60)

    report: dict[str, object] = {"steps": []}

    # 1) Ensure missing module file
    sftp = c.open_sftp()
    with sftp.file(TITLE_MATCH_PATH, "w") as f:
        f.write(TITLE_MATCH_SOURCE)
    sftp.close()
    code, out = run(
        c,
        f"cd {QIANFAN_DIR} && node -e \"require('./src/protocol/qianfan-shop-title-match'); console.log('module_ok')\"",
    )
    report["steps"].append({"write_title_match": code, "out": out})

    # 2) Patch ecosystem
    _, eco_raw = run(c, f"cat {ECOSYSTEM_PATH}")
    eco_patched = patch_ecosystem(eco_raw)
    if eco_patched != eco_raw:
        eco_b64 = __import__("base64").b64encode(eco_patched.encode("utf-8")).decode("ascii")
        code, out = run(
            c,
            f"echo {eco_b64} | base64 -d > {ECOSYSTEM_PATH}",
        )
        report["steps"].append({"patch_ecosystem": code, "changed": True})
    else:
        report["steps"].append({"patch_ecosystem": 0, "changed": False})

    # 3) Restart daemon with updated env
    restart_cmds = [
        f"cd {QIANFAN_DIR} && pm2 startOrRestart ecosystem.config.cjs --only qianfan-protocol-daemon --update-env",
        "pm2 reset qianfan-protocol-daemon",
        "pm2 save",
    ]
    for cmd in restart_cmds:
        code, out = run(c, cmd)
        report["steps"].append({cmd.split("&&")[-1].strip() if "&&" in cmd else cmd: {"code": code, "out": out[-500:]}})

    time.sleep(8)

    # 4) Verify
    code, health = run(c, "curl -s http://127.0.0.1:9324/api/health")
    report["health"] = health
    report["pm2"] = run(c, "pm2 describe qianfan-protocol-daemon | grep -E 'status|restarts|uptime|memory|Heap|cpu'")[1]
    report["require_after"] = run(
        c,
        f"grep -c \"Cannot find module './qianfan-shop-title-match'\" /root/.pm2/logs/qianfan-protocol-daemon-error.log || echo 0",
    )[1]
    report["mem_top"] = run(c, "ps aux | grep qianfan-protocol-daemon | grep -v grep")[1]
    report["out_tail"] = run(c, "tail -8 /root/.pm2/logs/qianfan-protocol-daemon-out.log")[1]

    c.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if '"ok":true' not in health.replace(" ", ""):
        raise SystemExit("health check failed")


if __name__ == "__main__":
    main()
