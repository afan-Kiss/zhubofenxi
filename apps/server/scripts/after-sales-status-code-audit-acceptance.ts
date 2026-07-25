/**
 * npm run accept:after-sales-status-code-audit
 */
import assert from 'node:assert/strict'
import {
  auditUnknownAfterSaleStatusCodesInRaw,
  hasMeaningfulAfterSaleStatus,
  noteUnknownAfterSaleStatusCode,
  resetUnknownAfterSaleStatusCodeDedupForTests,
  resolveAfterSaleStatusCode,
  resolveAfterSalesQueueEligibility,
  rawHasAfterSaleField,
  getUnknownAfterSaleStatusCodeUniqueCount,
} from '../src/services/after-sales-fetch-decision.service'

function base(p?: Partial<Parameters<typeof resolveAfterSalesQueueEligibility>[0]>) {
  return {
    displayOrderNo: 'P800000000000000099',
    officialOrderNo: 'P800000000000000099',
    orderStatusText: '已签收',
    afterSaleStatusText: '无售后',
    ...p,
  }
}

function main(): void {
  console.log('accept:after-sales-status-code-audit\n')
  resetUnknownAfterSaleStatusCodeDedupForTests()

  assert.equal(resolveAfterSaleStatusCode(1).semantic, 'no_after_sale')
  assert.equal(resolveAfterSaleStatusCode(1).hasAfterSaleSignal, false)
  assert.equal(resolveAfterSaleStatusCode('1').hasAfterSaleSignal, false)
  assert.equal(resolveAfterSaleStatusCode(0).hasAfterSaleSignal, false)
  assert.equal(hasMeaningfulAfterSaleStatus(1), false)
  assert.equal(hasMeaningfulAfterSaleStatus(0), false)
  assert.equal(hasMeaningfulAfterSaleStatus('1'), false)
  console.log('✓ 0/1 无售后')

  assert.equal(resolveAfterSaleStatusCode(2).semantic, 'active_after_sale')
  assert.equal(resolveAfterSaleStatusCode(3).semantic, 'completed_after_sale')
  assert.equal(hasMeaningfulAfterSaleStatus(2), true)
  assert.equal(hasMeaningfulAfterSaleStatus(3), true)
  console.log('✓ 已知 2/3 为售后信号')

  const unk = resolveAfterSaleStatusCode(8)
  assert.equal(unk.known, false)
  assert.equal(unk.hasAfterSaleSignal, false)
  assert.equal(hasMeaningfulAfterSaleStatus(8), false)
  console.log('✓ 未知码单独不算售后信号')

  resetUnknownAfterSaleStatusCodeDedupForTests()
  assert.equal(
    noteUnknownAfterSaleStatusCode({ code: 8, liveAccountId: 'shopA', orderNo: 'P1' }),
    true,
  )
  assert.equal(
    noteUnknownAfterSaleStatusCode({ code: 8, liveAccountId: 'shopA', orderNo: 'P2' }),
    false,
  )
  assert.equal(getUnknownAfterSaleStatusCodeUniqueCount(), 1)
  console.log('✓ 未知码日志短窗去重')

  // 14. 未知码无其他信号 → 不入队
  {
    const r = resolveAfterSalesQueueEligibility(
      base({ afterSaleStatusText: undefined, raw: { afterSaleStatus: 8 } }),
    )
    assert.equal(r.eligible, false)
    assert.equal(rawHasAfterSaleField({ afterSaleStatus: 8 }), false)
    console.log('✓ 未知码单独不入队')
  }

  // 15. 未知码 + returnsId → 入队
  {
    const r = resolveAfterSalesQueueEligibility(
      base({
        afterSaleStatusText: undefined,
        orderStatusText: '已发货',
        raw: { afterSaleStatus: 8, returns_id: 'R123456789' },
      }),
    )
    assert.equal(r.eligible, true)
    console.log('✓ 未知码+returnsId 可入队')
  }

  // 16. 已知码不增加未知计数
  resetUnknownAfterSaleStatusCodeDedupForTests()
  auditUnknownAfterSaleStatusCodesInRaw(
    { afterSaleStatus: 2, firstAfterSaleStatus: 3 },
    { liveAccountId: 's', orderNo: 'P9' },
  )
  assert.equal(getUnknownAfterSaleStatusCodeUniqueCount(), 0)
  console.log('✓ 已知码不写未知审计')

  const codes = auditUnknownAfterSaleStatusCodesInRaw(
    { afterSaleStatus: 9 },
    { liveAccountId: 's', orderNo: 'P9' },
  )
  assert.deepEqual(codes, [9])
  console.log('✓ 未知码审计返回 code 列表')

  console.log('\nALL PASS')
}

main()
