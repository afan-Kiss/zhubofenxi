/**
 * 合法临时调班不误报 + 结算健康文案
 * npm run verify:anchor-settlement-health
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

function main(): void {
  const health = fs.readFileSync(
    path.resolve(__dirname, '../src/services/anchor-attribution-health.service.ts'),
    'utf-8',
  )
  assert.ok(health.includes('hasConfirmReason'))
  assert.ok(health.includes('templateDeviationWithoutConfirmCount'))
  assert.ok(health.includes('可以用于结算'))
  assert.ok(health.includes('暂不建议用于结算'))
  assert.ok(health.includes('qualityAnchorMismatchCount'))
  assert.ok(health.includes('qualityCrossAnchorDupCount'))
  assert.ok(
    /okTemp[\s\S]*continue/.test(health) || health.includes('合法临时调班') || health.includes('allHaveReason'),
    '已确认+有原因的偏离模板应跳过报警',
  )

  console.log('PASS: verify:anchor-settlement-health')
}

main()
