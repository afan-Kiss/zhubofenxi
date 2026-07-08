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
  log "npm ci --include=dev"
  npm ci --include=dev
  log "prisma generate"
  npm run db:generate -w @live/server
  log "prisma migrate deploy"
  npm run db:migrate:deploy -w @live/server
  if [[ "${RUN_SCHEDULE_REPAIR_20260701:-0}" == "1" ]]; then
    log "repair schedule templates from 20260701"
    npx tsx apps/server/scripts/repair-schedule-templates-20260701.ts
  else
    log "skip schedule repair templates from 20260701 (set RUN_SCHEDULE_REPAIR_20260701=1 to run manually)"
  fi
  log "npm run build"
  WEB_BASE_PATH_VALUE="$(grep -E '^WEB_BASE_PATH=' apps/server/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "' || true)"
  if [[ -n "$WEB_BASE_PATH_VALUE" && "$WEB_BASE_PATH_VALUE" != "/" ]]; then
    bp="/${WEB_BASE_PATH_VALUE#/}"
    bp="${bp%/}"
    export VITE_BASE_PATH="${bp}/"
    log "VITE_BASE_PATH=$VITE_BASE_PATH"
  fi
  npm run build
  verify_web_build
}

verify_web_build() {
  local index="$DEPLOY_DIR/apps/web/dist/index.html"
  [[ -f "$index" ]] || fail "缺少 apps/web/dist/index.html"
  local script_src
  script_src="$(grep -oE 'src="[^"]+"' "$index" | head -1 || true)"
  if [[ -z "$script_src" ]]; then
    fail "index.html 未找到 script src"
  fi
  if [[ "$script_src" == *'="//'* || "$script_src" == *"='//"* ]]; then
    fail "index.html 静态资源为协议相对路径（会导致白屏）: $script_src"
  fi
  local bp="${WEB_BASE_PATH_VALUE:-}"
  if [[ -n "$bp" && "$bp" != "/" ]]; then
    bp="/${bp#/}"
    bp="${bp%/}"
    if ! grep -q "src=\"${bp}/assets/" "$index"; then
      fail "index.html 静态资源路径异常: $script_src（期望 ${bp}/assets/...）"
    fi
  fi
  log "web build OK: $script_src"
  local dist_js
  dist_js="$(grep -oE 'assets/index-[^"]+\.js' "$index" | head -1 || true)"
  if [[ -z "$dist_js" || ! -f "$DEPLOY_DIR/apps/web/dist/$dist_js" ]]; then
    fail "无法定位 dist JS 文件: ${dist_js:-empty}"
  fi
  local good_review_js="$dist_js"
  local lazy_chunk
  lazy_chunk="$(ls "$DEPLOY_DIR/apps/web/dist/assets"/GoodReviewsPage-*.js 2>/dev/null | head -1 || true)"
  if [[ -n "$lazy_chunk" ]]; then
    good_review_js="${lazy_chunk#"$DEPLOY_DIR/apps/web/dist/"}"
    log "good reviews lazy chunk: $good_review_js"
  fi
  grep -q '同步全部店铺好评' "$DEPLOY_DIR/apps/web/dist/$good_review_js" || fail "dist JS 缺少「同步全部店铺好评」"
  grep -q '加载更多好评' "$DEPLOY_DIR/apps/web/dist/$good_review_js" || fail "dist JS 缺少「加载更多好评」"
  grep -q 'good-review-material-v3' "$DEPLOY_DIR/apps/web/dist/$good_review_js" || fail "dist JS 缺少版本标记"
  log "dist JS 文案验收通过"
}

write_deploy_build_meta() {
  local env_file="$DEPLOY_DIR/apps/server/.env"
  local commit="${DEPLOY_GIT_COMMIT:-unknown}"
  local app_version="0.2.0"
  if [[ "$commit" == "unknown" ]] && command -v git >/dev/null 2>&1 && [[ -d "$DEPLOY_DIR/.git" ]]; then
    commit="$(cd "$DEPLOY_DIR" && git rev-parse HEAD 2>/dev/null || echo unknown)"
  fi
  if [[ "$commit" == "unknown" ]] && [[ -f "$env_file" ]]; then
    local existing
    existing="$(grep -E '^GIT_COMMIT=' "$env_file" | tail -1 | cut -d= -f2- | tr -d ' "' || true)"
    if [[ -n "$existing" && "$existing" != "unknown" ]]; then
      commit="$existing"
    fi
  fi
  if [[ -f "$DEPLOY_DIR/package.json" ]]; then
    app_version="$(node -p "require('./package.json').version || '0.2.0'" 2>/dev/null || echo 0.2.0)"
  fi
  upsert_env_var() {
    local key="$1" val="$2"
    if grep -q "^${key}=" "$env_file"; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$env_file"
    else
      echo "${key}=${val}" >> "$env_file"
    fi
  }
  upsert_env_var "GIT_COMMIT" "$commit"
  upsert_env_var "APP_VERSION" "$app_version"
  log "写入 build meta: GIT_COMMIT=${commit:0:8} APP_VERSION=$app_version"
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
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    if pm2 restart "$APP_NAME"; then
      pm2 save
      log "pm2 已重启 $APP_NAME"
    else
      log "WARN: pm2 restart 失败，尝试 delete 后重新 start"
      pm2 delete "$APP_NAME" 2>/dev/null || true
      pm2 start ecosystem.config.js
      pm2 save
      log "pm2 已重新启动 $APP_NAME"
    fi
  else
    pm2 start ecosystem.config.js
    pm2 save
    log "pm2 已启动 $APP_NAME"
  fi
}

wait_health() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:4723/api/health" | grep -q ok; then
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
  write_deploy_build_meta
  install_signer
  start_pm2
  wait_health
  log "部署完成。请配置 Nginx（见 deploy/aliyun/nginx-zhubo-analysis.conf.example）"
  log "验证: curl -i http://127.0.0.1:4723/api/health"
  log "公网: http://${PUBLIC_IP}/api/health"
}

main "$@"
