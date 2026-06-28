#!/usr/bin/env bash
set -euo pipefail
pm2 restart zhubo-analysis
pm2 save
echo "[restart] done"
curl -fsS http://127.0.0.1:4723/api/health || echo "[restart] health check failed — see pm2 logs zhubo-analysis"
