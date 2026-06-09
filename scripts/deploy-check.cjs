#!/usr/bin/env node
/**
 * 部署前检查（在项目根目录执行：npm run deploy:check）
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const serverDir = path.join(root, 'apps', 'server')
const webDist = path.join(root, 'apps', 'web', 'dist')
const serverDist = path.join(serverDir, 'dist', 'index.js')
const envPath = path.join(serverDir, '.env')
const dataDir = path.join(serverDir, 'data')

let failed = 0

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function fail(msg) {
  console.error(`  ✗ ${msg}`)
  failed += 1
}

console.log('\n[deploy:check] 生产部署检查\n')

if (!fs.existsSync(envPath)) {
  fail(`缺少 ${path.relative(root, envPath)}，请复制 .env.production.example 为 .env`)
} else {
  ok('apps/server/.env 存在')
  const env = fs.readFileSync(envPath, 'utf8')
  if (!env.includes('SESSION_SECRET=') || env.includes('请替换成随机长字符串')) {
    fail('SESSION_SECRET 未设置或仍为占位符，请生成随机字符串')
  } else {
    ok('SESSION_SECRET 已配置')
  }
  if (!env.match(/CORS_ORIGIN=.+/) && !env.match(/WEB_ORIGIN=.+/)) {
    fail('请设置 CORS_ORIGIN 为公网访问地址（如 http://你的IP）')
  } else {
    ok('CORS_ORIGIN / WEB_ORIGIN 已配置')
  }
  if (
    !env.includes('COOKIE_ENCRYPTION_KEY=') ||
    env.includes('请替换成') ||
    /COOKIE_ENCRYPTION_KEY=.{0,31}\s*$/m.test(env)
  ) {
    fail('COOKIE_ENCRYPTION_KEY 未设置或长度不足（至少 32 字符）')
  } else {
    ok('COOKIE_ENCRYPTION_KEY 已配置')
  }
}

if (!fs.existsSync(serverDist)) {
  fail('后端未构建，请执行 npm run build:server')
} else {
  ok('apps/server/dist/index.js 存在')
}

if (!fs.existsSync(path.join(webDist, 'index.html'))) {
  fail('前端未构建，请执行 npm run build:web')
} else {
  ok('apps/web/dist/index.html 存在')
}

if (!fs.existsSync(dataDir)) {
  console.log('  · data/ 目录将在首次启动时创建')
} else {
  ok('apps/server/data/ 目录存在（SQLite 持久化）')
}

const schema = path.join(serverDir, 'prisma', 'schema.prisma')
if (!fs.existsSync(schema)) {
  fail('缺少 prisma/schema.prisma')
} else {
  ok('Prisma schema 存在')
}

console.log('')
if (failed > 0) {
  console.error(`[deploy:check] 未通过：${failed} 项需处理\n`)
  process.exit(1)
}
console.log('[deploy:check] 全部通过，可启动 PM2 并配置 Nginx\n')
