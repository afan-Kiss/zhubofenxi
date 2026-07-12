/**
 * 退货退款分类单元验收：
 * 1. 退货退款成功计入
 * 2. 仅退款不计入退货退款
 * 3. 售后申请中不计入
 * 4. 售后取消且退款0不计入
 * 5. 售后关闭无退款不计入
 * 6. 纯运费退款不计入
 * 7. rawDetail缺失但结构化字段存在仍能统计
 * 8. 有退款金额但分类未知 → unknown，不能当 return_refund
 */
import assert from 'node:assert/strict'
import {
  deriveStructuredAfterSaleTypeFromRaw,
  resolveReturnRefundClassification,
} from '../src/services/resolve-return-refund-classification.service'

function ok(name: string) {
  console.log(`✓ ${name}`)
}

function makeReturnRefundRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delivery_package_id: 'P1',
    return_type: 1,
    return_type_name: '退货',
    status: 4,
    status_name: '已完成',
    refund_status: 2,
    refund_status_name: '退款成功',
    refunded: true,
    refund_fee: 100,
    reason_name_zh: '质量问题',
    ...overrides,
  }
}

function makeRefundOnlyRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delivery_package_id: 'P2',
    return_type: 4,
    return_type_name: '已发货仅退款',
    status: 4,
    status_name: '已完成',
    refund_status: 2,
    refund_status_name: '退款成功',
    refunded: true,
    refund_fee: 80,
    reason_name_zh: '多拍/拍错/不想要',
    ...overrides,
  }
}

function main() {
  // 1
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: true,
      rawAfterSales: [makeReturnRefundRaw()],
    })
    assert.equal(r.isReturnRefundOrder, true)
    assert.equal(r.resolvedAfterSaleType, 'return_refund')
    ok('退货退款成功计入')
  }

  // 2
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: true,
      rawAfterSales: [makeRefundOnlyRaw()],
    })
    assert.equal(r.isReturnRefundOrder, false)
    assert.equal(r.isRefundOnlyOrder, true)
    ok('仅退款不计入退货退款')
  }

  // 3 pending
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: false,
      rawAfterSales: [
        makeReturnRefundRaw({
          refunded: false,
          refund_fee: 0,
          refund_status_name: '',
          status_name: '待审核',
          status: 1,
        }),
      ],
      afterSaleStatusText: '退货退款申请中',
    })
    assert.equal(r.isReturnRefundOrder, false)
    assert.equal(r.resolvedAfterSaleType, 'none')
    ok('售后申请中不计入')
  }

  // 4 cancel 0
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: false,
      classification: {
        countsAsReturnRefund: false,
        countsAsRefundOnly: false,
        isReturnRefund: false,
        isRefundOnly: false,
        isFreightRefundOnly: false,
      },
      afterSaleStatusText: '售后取消',
    })
    assert.equal(r.isReturnRefundOrder, false)
    ok('售后取消且退款0不计入')
  }

  // 5 closed no refund
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: false,
      afterSaleStatusText: '售后关闭',
    })
    assert.equal(r.isReturnRefundOrder, false)
    ok('售后关闭无退款不计入')
  }

  // 6 freight
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: false,
      isFreightRefundOnly: true,
    })
    assert.equal(r.isReturnRefundOrder, false)
    assert.equal(r.resolvedAfterSaleType, 'freight_only')
    ok('纯运费退款不计入')
  }

  // 7 structured without raw
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: true,
      structuredCache: {
        hasReturnRefund: true,
        hasRefundOnly: false,
        afterSaleType: 'return_refund',
        classificationSource: 'raw_return_type',
      },
    })
    assert.equal(r.isReturnRefundOrder, true)
    assert.equal(r.classificationSource, 'structured_cache')
    ok('rawDetail缺失但结构化分类字段存在时仍能统计')
  }

  // 8 unknown
  {
    const r = resolveReturnRefundClassification({
      hasSuccessfulProductRefund: true,
      afterSaleStatusText: '退款成功',
      classification: {
        countsAsReturnRefund: false,
        countsAsRefundOnly: true,
        isReturnRefund: false,
        isRefundOnly: true,
        isFreightRefundOnly: false,
      },
    })
    assert.equal(r.typeKnown, false)
    assert.equal(r.resolvedAfterSaleType, 'unknown')
    assert.equal(r.isReturnRefundOrder, false)
    ok('有退款金额但分类未知时标记 unknown（不显示为退货退款0的假可信）')
  }

  // derive structured
  {
    const s = deriveStructuredAfterSaleTypeFromRaw([
      makeReturnRefundRaw(),
      makeRefundOnlyRaw({ delivery_package_id: 'P3' }),
    ])
    assert.equal(s.hasReturnRefund, true)
    assert.equal(s.hasRefundOnly, true)
    assert.equal(s.returnRefundCount, 1)
    assert.equal(s.refundOnlyCount, 1)
    ok('deriveStructuredAfterSaleTypeFromRaw 同时识别退货退款与仅退款')
  }

  console.log('\nverify:return-refund-classification PASS')
}

main()
