#!/usr/bin/env bash
set -euo pipefail

echo "=== zhubo-analysis status ==="
echo
echo "[pm2]"
pm2 status zhubo-analysis 2>/dev/null || echo "  pm2 process not found"
echo
echo "[ports]"
ss -lntp 2>/dev/null | grep -E ':4723|:80 ' || netstat -lntp 2>/dev/null | grep -E ':4723|:80 ' || true
echo
echo "[health direct 4723]"
curl -i --max-time 8 http://127.0.0.1:4723/api/health 2>/dev/null || echo "  FAIL"
echo
echo "[health via nginx :80]"
curl -i --max-time 8 http://127.0.0.1/api/health 2>/dev/null || echo "  FAIL (nginx may not be configured)"
echo
echo "[logs] pm2 logs zhubo-analysis --lines 50"
