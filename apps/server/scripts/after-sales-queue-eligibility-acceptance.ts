/**
 * 售后队列入队资格 — 验收（金额不参与资格）
 * npm run accept:after-sales-queue-eligibility
 */
import assert from 'node:assert/strict'
import {
  hasMeaningfulAfterSaleId,
  hasMeaningfulAfterSaleObject,
  hasPositiveRefundAmount,
  rawHasAfterSaleField,
  resolveAfterSalesQueueEligibility,
  AFTER_SALES_QUEUE_PRIORITY,
} from '../src/services/after-sales-fetch-decision.service'

function base(p?: Partial<Parameters<typeof resolveAfterSalesQueueEligibility>[0]>) {
  return {
    displayOrderNo: 'P800000000000000001',
    officialOrderNo: 'P800000000000000001',
    orderStatusText: '已签收',
    afterSaleStatusText: '无售后',
    ...p,
  }
}

function main(): void {
  console.log('accept:after-sales-queue-eligibility\n')

  // 1-4: 无售后不入队（含各金额）
  for (const [name, paidNote] of [
    ['10分无售后', 'actualPaidCent=10'],
    ['100分 afterSaleStatus0', 'status0'],
    ['2980分无售后', '2980'],
    ['100000分无售后', '100000'],
  ] as const) {
    const input =
      name.includes('status0')
        ? base({
            afterSaleStatusText: undefined,
            raw: { afterSaleStatus: 0, refundAmount: 0 },
          })
        : base()
    const r = resolveAfterSalesQueueEligibility(input)
    assert.equal(r.eligible, false, `${name} 应不入队 (${paidNote})`)
    console.log(`✓ ${name} 不入队`)
  }

  // 5: 小额 + 待商家收货
  {
    const r = resolveAfterSalesQueueEligibility(
      base({ afterSaleStatusText: '售后处理中: 待商家收货' }),
    )
    assert.equal(r.eligible, true)
    assert.ok(r.priority >= AFTER_SALES_QUEUE_PRIORITY.RETURN_IN_TRANSIT)
    console.log('✓ 10分级「待商家收货」入队高优先级')
  }

  // 6: returnsId
  {
    const r = resolveAfterSalesQueueEligibility(
      base({
        afterSaleStatusText: undefined,
        orderStatusText: '已发货',
        raw: { returns_id: 'R2746309145069845' },
      }),
    )
    assert.equal(r.eligible, true)
    console.log('✓ 有效 returnsId 入队')
  }

  // 7: 售后处理中高优先级
  {
    const r = resolveAfterSalesQueueEligibility(
      base({ afterSaleStatusText: '售后处理中' }),
    )
    assert.equal(r.eligible, true)
    assert.ok(r.priority >= AFTER_SALES_QUEUE_PRIORITY.PROCESSING)
    console.log('✓ 售后处理中高优先级入队')
  }

  // 8-10: 金额/空对象不算信号
  assert.equal(hasPositiveRefundAmount(0), false)
  assert.equal(hasPositiveRefundAmount('0.00'), false)
  assert.equal(hasMeaningfulAfterSaleObject({ afterSaleStatus: 0, refundAmount: 0 }), false)
  assert.equal(rawHasAfterSaleField({ afterSaleStatus: 0, refund_amount: 0 }), false)
  assert.equal(rawHasAfterSaleField({ afterSaleInfo: {} }), false)
  console.log('✓ refund 0 / 0.00 / 空对象不算售后信号')

  // 11: 有效退款单号
  assert.equal(hasMeaningfulAfterSaleId('R123'), true)
  assert.equal(hasMeaningfulAfterSaleId('0'), false)
  assert.equal(hasMeaningfulAfterSaleId(0), false)
  console.log('✓ 有效退款单号算信号，0 不算')

  // 12: 有效 success 缓存不重开
  {
    const r = resolveAfterSalesQueueEligibility(base({ afterSaleStatusText: '退款成功' }), {
      cacheCurrentlyValid: true,
      cacheMissingOrStale: false,
    })
    assert.equal(r.eligible, false)
    console.log('✓ 有效 success 缓存不入队')
  }

  // 13: empty 失效后有售后状态 → 入队
  {
    const r = resolveAfterSalesQueueEligibility(
      base({ afterSaleStatusText: '待商家收货' }),
      { cacheCurrentlyValid: false, cacheMissingOrStale: true },
    )
    assert.equal(r.eligible, true)
    console.log('✓ empty 失效后出现售后状态可入队')
  }

  // 14: 官方品退缺详情
  {
    const r = resolveAfterSalesQueueEligibility(base(), {
      officialQualityCaseMatched: true,
      cacheMissingOrStale: true,
      cacheCurrentlyValid: false,
    })
    assert.equal(r.eligible, true)
    assert.equal(r.priority, AFTER_SALES_QUEUE_PRIORITY.OFFICIAL_QUALITY)
    console.log('✓ 官方品退缺详情 priority=100')
  }

  // 17: 小额真实售后不因金额过滤（金额未传入 eligibility）
  {
    const r = resolveAfterSalesQueueEligibility(
      base({ afterSaleStatusText: '仅退款', orderStatusText: '售后关闭' }),
    )
    assert.equal(r.eligible, true)
    console.log('✓ 小额真实售后不因金额被过滤')
  }

  // 优先级：待商家收货 > 普通重试
  {
    const high = resolveAfterSalesQueueEligibility(
      base({ afterSaleStatusText: '待商家收货' }),
    )
    assert.ok(high.priority > AFTER_SALES_QUEUE_PRIORITY.NORMAL_RETRY)
    console.log('✓ 高优先级真实售后 > 普通重试')
  }

  // 平台 raw：afterSaleStatus=1 + 文案「无售后」不算信号（曾导致全量积压）
  {
    const r = resolveAfterSalesQueueEligibility(
      base({
        orderStatusText: '已签收',
        afterSaleStatusText: '无售后',
        raw: {
          afterSaleStatus: 1,
          firstAfterSaleStatus: 1,
          secondAfterSaleStatus: -1,
          skus: [{ afterSaleStatus: 1, afterSaleStatusDesc: '无售后' }],
        },
      }),
    )
    assert.equal(r.eligible, false, 'status=1 无售后不应入队')
    assert.equal(rawHasAfterSaleField({ afterSaleStatus: 1, firstAfterSaleStatus: 1 }), false)
    console.log('✓ afterSaleStatus=1 / 无售后 不入队')
  }

  // 物流「待收货」≠ 售后信号
  {
    const r = resolveAfterSalesQueueEligibility(
      base({
        orderStatusText: '待收货',
        afterSaleStatusText: '无售后',
        raw: { afterSaleStatus: 1 },
      }),
    )
    assert.equal(r.eligible, false, '订单物流待收货不应入队')
    console.log('✓ 订单物流待收货不入队')
  }

  // 真实售后码 2/3 仍入队
  {
    const r2 = resolveAfterSalesQueueEligibility(
      base({
        afterSaleStatusText: undefined,
        orderStatusText: '已发货',
        raw: { afterSaleStatus: 2, firstAfterSaleStatus: 2 },
      }),
    )
    assert.equal(r2.eligible, true, 'status=2 应入队')
    const r3 = resolveAfterSalesQueueEligibility(
      base({
        afterSaleStatusText: '售后关闭',
        isReturned: true,
        raw: { afterSaleStatus: 3, firstAfterSaleStatus: 3 },
      }),
    )
    assert.equal(r3.eligible, true, 'status=3 售后关闭应入队')
    console.log('✓ afterSaleStatus=2/3 真实售后仍入队')
  }

  console.log('\nALL PASS')
}

main()
