/**
 * 静态验收：boss-dashboard Router 不得出现重复 method + path
 */
import fs from 'node:fs'
import path from 'node:path'

const ROUTE_FILE = path.join(__dirname, '../src/routes/boss-dashboard.routes.ts')
const src = fs.readFileSync(ROUTE_FILE, 'utf8')

const re = /bossDashboardRouter\.(get|post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g
const seen = new Map<string, number>()
let m: RegExpExecArray | null
while ((m = re.exec(src))) {
  const key = `${m[1]!.toUpperCase()} ${m[2]}`
  seen.set(key, (seen.get(key) ?? 0) + 1)
}

const dupes = [...seen.entries()].filter(([, n]) => n > 1)
if (dupes.length) {
  console.error('[FAIL] 重复路由:')
  for (const [k, n] of dupes) console.error(`  ${k} x${n}`)
  process.exit(1)
}

const billOrders = seen.get('GET /bill-orders') ?? 0
if (billOrders !== 1) {
  console.error(`[FAIL] GET /bill-orders 出现 ${billOrders} 次，期望 1`)
  process.exit(1)
}

console.log('[ok] boss-dashboard 路由 method+path 唯一')
console.log('[ok] GET /bill-orders 仅一处')
console.log('\nALL PASS: verify:boss-dashboard-route-uniqueness')
