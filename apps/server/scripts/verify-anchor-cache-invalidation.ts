/**
 * 排班变更后缓存失效（含归属算法版本）
 * npm run verify:anchor-cache-invalidation
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CANONICAL_ATTRIBUTION_VERSION } from '../src/services/canonical-order-attribution.service'

function main(): void {
  const cacheFile = path.resolve(__dirname, '../src/services/business-cache.service.ts')
  const text = fs.readFileSync(cacheFile, 'utf-8')
  assert.ok(text.includes('CANONICAL_ATTRIBUTION_VERSION'), '经营缓存应引用归属算法版本')
  assert.ok(text.includes('attributionAlgorithmVersion'), '缓存条目应存储 attributionAlgorithmVersion')
  assert.ok(
    text.includes('归属算法版本变更'),
    '版本 bump 后应强制重建经营缓存',
  )

  const scheduleCache = fs.readFileSync(
    path.resolve(__dirname, '../src/services/anchor-schedule-cache.service.ts'),
    'utf-8',
  )
  assert.ok(scheduleCache.includes('clearScheduleAttributionCache'))
  assert.ok(scheduleCache.includes('invalidateBusinessBoardCache'))

  assert.ok(CANONICAL_ATTRIBUTION_VERSION.startsWith('canonical-'))
  console.log(`PASS: verify:anchor-cache-invalidation (${CANONICAL_ATTRIBUTION_VERSION})`)
}

main()
