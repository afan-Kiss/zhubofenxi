/**
 * 静态验收：isOfflineDealView 循环依赖拆除
 * npx tsx apps/server/scripts/verify-offline-deal-module-boundary.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const serverSrc = path.resolve(__dirname, '../src')

function read(rel: string): string {
  return fs.readFileSync(path.join(serverSrc, rel), 'utf8')
}

function assertNoImport(file: string, forbidden: string) {
  const src = read(file)
  assert.ok(
    !src.includes(forbidden),
    `${file} 不应引用 ${forbidden}`,
  )
}

function main() {
  console.log('verify-offline-deal-module-boundary\n')

  const util = read('utils/offline-deal-view.util.ts')
  assert.ok(util.includes('export function isOfflineDealView'))
  assert.ok(!/from ['\"].*services\//.test(util))
  assert.ok(!/from ['\"]@prisma/.test(util))
  assert.ok(!/from ['\"].*lib\/prisma/.test(util))
  assert.ok(!util.includes('offline-deal.service'))
  console.log('  ✓ 纯工具文件无 service/prisma 依赖')

  assertNoImport(
    'services/quality-refund-cross-verify.service.ts',
    "from './offline-deal.service'",
  )
  assertNoImport(
    'services/quality-refund-resolution.service.ts',
    "from './offline-deal.service'",
  )
  assert.ok(
    read('services/quality-refund-cross-verify.service.ts').includes(
      'offline-deal-view.util',
    ),
  )
  assert.ok(
    read('services/quality-refund-resolution.service.ts').includes(
      'offline-deal-view.util',
    ),
  )
  console.log('  ✓ quality-refund-* 不再引用 offline-deal.service')

  const metrics = read('services/business-metrics.service.ts')
  assert.ok(!metrics.includes("from './offline-deal.service'"))
  assert.ok(!metrics.includes('isOfflineDealView'))
  console.log('  ✓ business-metrics 不经 offline-deal.service 取纯识别函数')

  const offlineDeal = read('services/offline-deal.service.ts')
  assert.ok(offlineDeal.includes("from '../utils/offline-deal-view.util'"))
  assert.ok(offlineDeal.includes('export { isOfflineDealView }'))
  console.log('  ✓ offline-deal.service 兼容再导出')

  for (const f of [
    'services/buyer-order-standard.service.ts',
    'services/order-row-mapper.service.ts',
    'services/canonical-order-attribution.service.ts',
  ]) {
    assert.ok(read(f).includes('offline-deal-view.util'), `${f} 应直引纯工具`)
    assertNoImport(f, "from './offline-deal.service'")
  }
  console.log('  ✓ 核心识别消费者直引纯工具')

  console.log('\nPASS')
}

main()
