#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/www/wwwroot/zhubo-analysis"
MARKER="/www/wwwroot/.zhubo-analysis-last-backup"

if [[ ! -f "$MARKER" ]]; then
  echo "未找到备份标记 $MARKER"
  echo "请手动指定备份目录，例如："
  echo "  BACKUP=/www/wwwroot/zhubo-analysis-backup-YYYYMMDD-HHMMSS bash deploy/aliyun/rollback.sh"
  exit 1
fi

BACKUP="${BACKUP:-$(cat "$MARKER")}"

if [[ ! -d "$BACKUP" ]]; then
  echo "备份目录不存在: $BACKUP"
  exit 1
fi

echo "将回滚到: $BACKUP"
echo "停止 pm2..."
pm2 stop zhubo-analysis 2>/dev/null || true

ts="$(date +%Y%m%d-%H%M%S)"
failed="/www/wwwroot/zhubo-analysis-failed-${ts}"
if [[ -d "$DEPLOY_DIR" ]]; then
  mv "$DEPLOY_DIR" "$failed"
  echo "当前失败版本移至: $failed"
fi

cp -a "$BACKUP" "$DEPLOY_DIR"
cd "$DEPLOY_DIR"
pm2 restart zhubo-analysis || pm2 start ecosystem.config.js
pm2 save

echo "回滚完成。请运行 deploy/aliyun/status.sh 验收。"
