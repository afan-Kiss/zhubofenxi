#!/usr/bin/env node
/** start:server 前检查：生产需先 npm run build 生成 apps/web/dist */
const fs = require('node:fs')
const path = require('node:path')

const indexHtml = path.join(__dirname, '..', 'apps', 'web', 'dist', 'index.html')
const serverJs = path.join(__dirname, '..', 'apps', 'server', 'dist', 'index.js')

let failed = 0

if (!fs.existsSync(serverJs)) {
  console.error('[start] 后端未构建，请先执行：npm run build:server')
  failed += 1
}

if (!fs.existsSync(indexHtml)) {
  console.error('[start] 前端未构建，请先执行：npm run build:web  或  npm run build')
  failed += 1
}

if (failed > 0) {
  process.exit(1)
}
