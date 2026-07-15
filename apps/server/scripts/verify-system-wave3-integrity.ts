/**
 * Wave3 售后改造静态完整性 — 验收
 * npm run verify:system-wave3-integrity
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const ROOT = path.resolve(__dirname, '..')
const REPO = path.resolve(__dirname, '../../..')

function read(relFromServer: string): string {
  return fs.readFileSync(path.resolve(ROOT, relFromServer), 'utf-8')
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.resolve(REPO, rel), 'utf-8')
}

function mustInclude(src: string, needle: string, label: string): void {
  assert.ok(src.includes(needle), `${label} 应包含：${needle}`)
}

function mustNotInclude(src: string, needle: string, label: string): void {
  assert.ok(!src.includes(needle), `${label} 不应包含：${needle}`)
}

function main(): void {
  console.log('verify:system-wave3-integrity\n')

  const workbench = read('src/services/xhs-after-sales-workbench.service.ts')
  mustInclude(
    workbench,
    'runAfterSalesBackfillBatch',
    'processWorkbenchQueueBatch',
  )

  const syncAll = read('src/services/xhs-after-sales-workbench.service.ts')
  mustNotInclude(syncAll, 'processWorkbenchQueueBatch(5000)', 'syncAllOrdersWorkbenchFromRaw')
  mustInclude(syncAll, '不在此处 process 5000', 'syncAllOrdersWorkbenchFromRaw 注释')

  const har = readRepo('apps/server/scripts/verify-four-shop-har-june.ts')
  mustNotInclude(har, 'paidAt || o.orderedAt', 'HAR 脚本')
  mustNotInclude(har, 'paidAt || orderedAt', 'HAR 脚本')
  mustInclude(har, '禁止用 orderedAt 替代', 'HAR 脚本口径说明')

  const completeness = read('src/services/after-sales-completeness.service.ts')
  mustInclude(completeness, "'failed'", 'completeness failed 状态')
  mustInclude(completeness, 'export function decideStatus', 'decideStatus 已导出')

  const schema = read('prisma/schema.prisma')
  mustInclude(schema, 'model ShopAfterSalesRuntime', 'schema ShopAfterSalesRuntime')
  mustInclude(schema, 'model XhsAfterSalesRangeSyncMeta', 'schema XhsAfterSalesRangeSyncMeta')

  const workbenchSave = read('src/services/xhs-after-sales-workbench.service.ts')
  mustInclude(
    workbenchSave,
    'scheduleBusinessBoardCacheInvalidationForPayTime',
    'workbench save 缓存失效',
  )

  const backfill = read('src/services/after-sales-backfill.service.ts')
  mustInclude(backfill, 'selectAfterSalesQueueTasks', 'backfill 选任务')

  console.log('✓ Wave3 静态检查全部通过')
  console.log('\nPASS')
}

main()
