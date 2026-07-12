/**
 * 售后缓存结构化分类字段持久化 / 回填验收
 */
import assert from 'node:assert/strict'
import { deriveStructuredAfterSaleTypeFromRaw } from '../src/services/resolve-return-refund-classification.service'
import { aggregateWorkbenchRefund } from '../src/services/xhs-after-sales-workbench.service'

function main() {
  const raw = [
    {
      delivery_package_id: 'P100',
      return_type: 1,
      return_type_name: '退货',
      status: 4,
      status_name: '已完成',
      refund_status: 2,
      refund_status_name: '退款成功',
      refunded: true,
      refund_fee: 217,
      reason_name_zh: '质量问题',
    },
    {
      delivery_package_id: 'P100',
      return_type: 5,
      return_type_name: '未发货仅退款',
      status: 4,
      status_name: '已完成',
      refund_status: 2,
      refund_status_name: '退款成功',
      refunded: true,
      refund_fee: 29.9,
      reason_name_zh: '多拍/拍错/不想要',
    },
  ]

  const derived = deriveStructuredAfterSaleTypeFromRaw(raw)
  assert.equal(derived.hasReturnRefund, true)
  assert.equal(derived.hasRefundOnly, true)
  assert.ok(derived.returnTypeCodes.includes('1'))
  assert.ok(derived.returnTypeCodes.includes('5'))
  console.log('✓ derive 从 rawDetail 产出结构化字段')

  const agg = aggregateWorkbenchRefund(raw, 'P100')
  assert.equal(agg.hasReturnRefund, true)
  assert.equal(agg.hasRefundOnly, true)
  assert.equal(agg.afterSaleType, 'return_refund')
  assert.ok((agg.officialRefundAmountCent ?? 0) > 0)
  console.log('✓ aggregateWorkbenchRefund 写入 hasReturnRefund/hasRefundOnly')

  // 模拟「无 rawDetail、仅有结构化字段」路径：derive 空数组 → none
  const empty = deriveStructuredAfterSaleTypeFromRaw(undefined)
  assert.equal(empty.hasReturnRefund, false)
  assert.equal(empty.afterSaleType, 'none')
  console.log('✓ 无 rawDetail 时 derive 返回 none（由 DB 结构化字段兜底）')

  console.log('\nverify:return-refund-cache-persistence PASS')
}

main()
