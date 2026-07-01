#!/usr/bin/env bash
# 服务器端一键部署 / 更新（在 /www/wwwroot/zhubo-analysis 内执行）
set -euo pipefail

DEPLOY_DIR="/www/wwwroot/zhubo-analysis"
APP_NAME="zhubo-analysis"
PUBLIC_IP="${PUBLIC_IP:-8.137.126.18}"
GIT_REPO="${GIT_REPO:-https://github.com/afan-Kiss/zhubofenxi.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
USE_GIT="${USE_GIT:-1}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy][FAIL] $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"
}

backup_existing() {
  if [[ -d "$DEPLOY_DIR" ]] && [[ -n "$(ls -A "$DEPLOY_DIR" 2>/dev/null || true)" ]]; then
    local ts
    ts="$(date +%Y%m%d-%H%M%S)"
    local bak="/www/wwwroot/zhubo-analysis-backup-${ts}"
    log "备份现有目录 -> $bak"
    cp -a "$DEPLOY_DIR" "$bak"
    echo "$bak" > /www/wwwroot/.zhubo-analysis-last-backup
  fi
}

prepare_dir() {
  mkdir -p "$DEPLOY_DIR"
  mkdir -p "$DEPLOY_DIR/logs"
}

clone_or_update() {
  if [[ "$USE_GIT" == "1" ]]; then
    require_cmd git
    local temp_env=""
    if [[ -f "$DEPLOY_DIR/apps/server/.env" ]]; then
      temp_env="$(mktemp)"
      cp "$DEPLOY_DIR/apps/server/.env" "$temp_env"
    fi
    if [[ ! -d "$DEPLOY_DIR/.git" ]]; then
      log "Git clone -> $DEPLOY_DIR"
      rm -rf "$DEPLOY_DIR"
      git clone --depth 1 -b "$GIT_BRANCH" "$GIT_REPO" "$DEPLOY_DIR"
    else
      log "Git pull"
      cd "$DEPLOY_DIR"
      git fetch origin "$GIT_BRANCH"
      git checkout "$GIT_BRANCH"
      git pull --ff-only origin "$GIT_BRANCH"
    fi
    if [[ -n "$temp_env" ]]; then
      mkdir -p "$DEPLOY_DIR/apps/server"
      cp "$temp_env" "$DEPLOY_DIR/apps/server/.env"
      rm -f "$temp_env"
      log "已恢复 apps/server/.env"
    fi
  else
    log "USE_GIT=0，跳过 git，使用当前目录代码"
    [[ -f "$DEPLOY_DIR/package.json" ]] || fail "目录内无 package.json，请先上传代码"
  fi
}

check_env() {
  local env_file="$DEPLOY_DIR/apps/server/.env"
  if [[ ! -f "$env_file" ]]; then
    fail "缺少 apps/server/.env。请复制 deploy/aliyun/env.server.example 并填写密钥（勿提交 Git）"
  fi
  grep -q 'COOKIE_ENCRYPTION_KEY=.' "$env_file" || fail "COOKIE_ENCRYPTION_KEY 未配置"
  grep -q 'SESSION_SECRET=.' "$env_file" || fail "SESSION_SECRET 未配置"
  if grep -q '请替换' "$env_file"; then
    fail ".env 仍含占位符「请替换」，请改为真实随机字符串"
  fi
  log "apps/server/.env 已存在（不展示内容）"
}

install_deps_build() {
  cd "$DEPLOY_DIR"
  require_cmd node
  require_cmd npm
  log "Node $(node -v) / npm $(npm -v)"
  log "npm ci"
  npm ci
  log "prisma generate"
  npm run db:generate -w @live/server
  log "prisma migrate deploy"
  npm run db:migrate:deploy -w @live/server
  log "repair schedule templates from 20260701"
  npx tsx apps/server/scripts/repair-schedule-templates-20260701.ts
  log "npm run build"
  npm run build
}

install_signer() {
  if [[ -x "$DEPLOY_DIR/scripts/install-xhs-signer.sh" ]]; then
    log "install xhs signer"
    bash "$DEPLOY_DIR/scripts/install-xhs-signer.sh"
  else
    log "WARN: install-xhs-signer.sh 不存在，跳过签名依赖"
  fi
}

start_pm2() {
  require_cmd pm2
  cd "$DEPLOY_DIR"
  if [[ -f ecosystem.config.js ]]; then
    :
  elif [[ -f deploy/aliyun/ecosystem.config.example.js ]]; then
    cp deploy/aliyun/ecosystem.config.example.js ecosystem.config.js
  else
    fail "缺少 ecosystem.config.js"
  fi
  pm2 delete "$APP_NAME" 2>/dev/null || true
  pm2 start ecosystem.config.js
  pm2 save
  log "pm2 已启动 $APP_NAME"
}

wait_health() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:4723/api/health" | grep -q '"ok":true'; then
      log "本地 health OK"
      return 0
    fi
    sleep 2
  done
  fail "4723 health 检查失败，请 pm2 logs $APP_NAME"
}

main() {
  log "目标目录: $DEPLOY_DIR"
  log "公网 IP: $PUBLIC_IP"
  prepare_dir
  if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
    backup_existing
  fi
  clone_or_update
  check_env
  install_deps_build
  install_signer
  start_pm2
  wait_health
  log "部署完成。请配置 Nginx（见 deploy/aliyun/nginx-zhubo-analysis.conf.example）"
  log "验证: curl -i http://127.0.0.1:4723/api/health"
  log "公网: http://${PUBLIC_IP}/api/health"
}

main "$@"
