/**
 * 结算流水与订单 key 池匹配验收
 *
 * npm run verify:settlement-order-key-match
 */
import type { NormalizedOrder, SettlementRecord } from '../src/types/analysis'
import {
  buildOrderSettlementKeyIndex,
  collectOrderSettlementMatchKeys,
  collectSettlementRecordMatchKeys,
  expandSettlementMatchKeyVariants,
  resolveSettlementRecordCanonicalOrderId,
} from '../src/services/settlement-order-key-match.util'
import { buildSettlementMaps } from '../src/services/reconcile.service'
import { checkSettlementReconciliation } from '../src/services/data-validation.service'
import { normalizeSettlementItem } from '../src/services/xhs-api-sync/xhs-json-normalizer.service'

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

function order(partial: Partial<NormalizedOrder> & Pick<NormalizedOrder, 'sourceRowIndex'>): NormalizedOrder {
  return {
    orderId: partial.orderId ?? '',
    packageId: partial.packageId ?? '',
    bizOrderId: partial.bizOrderId ?? '',
    officialOrderNo: partial.officialOrderNo ?? '',
    displayOrderNo: partial.displayOrderNo ?? '',
    matchOrderId: partial.matchOrderId ?? partial.packageId ?? partial.orderId ?? '',
    orderTime: null,
    orderTimeText: '',
    monthKey: '2026-07',
    buyerId: 'b1',
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
    gmvSourceUsed: 'test',
    amountWarnings: [],
    orderStatusText: '已完成',
    afterSaleStatusText: '',
    reasonText: '',
    isSigned: true,
    isReturned: false,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    raw: {},
    ...partial,
  } as NormalizedOrder
}

function settlementRecord(params: {
  orderId: string
  raw?: Record<string, unknown>
  amountCent?: number
}): SettlementRecord {
  const normalized = normalizeSettlementItem(
    {
      packageId: params.raw?.packageId,
      settleNo: params.raw?.settleNo,
      settleBill: params.raw?.settleBill,
      ...params.raw,
    },
    'settled',
    1,
  )
  return {
    ...normalized,
    orderId: params.orderId,
    amountCent: params.amountCent ?? 5000,
    direction: 'income',
    raw: params.raw ?? {},
    errors: [],
  }
}

async function main(): Promise<void> {
  console.log('verify-settlement-order-key-match\n')
  let failures = 0

  console.log('=== 1. key 变体 ===')
  const variants = expandSettlementMatchKeyVariants('P798524075193091331')
  if (!variants.includes('798524075193091331') || !variants.includes('P798524075193091331')) {
    fail(`P 前缀变体缺失: ${variants.join(',')}`)
    failures++
  } else {
    ok('P 前缀缺失/存在变体')
  }

  console.log('\n=== 2. 订单 bizOrderId + 结算 packageId ===')
  const o1 = order({
    sourceRowIndex: 1,
    orderId: '798524075193091331',
    bizOrderId: '798524075193091331',
    packageId: 'P798524075193091331',
    matchOrderId: '798524075193091331',
    displayOrderNo: 'P798524075193091331',
    officialOrderNo: 'P798524075193091331',
  })
  const anchorMap = new Map([['798524075193091331', 'anchor-xiaoyi']])
  const index1 = buildOrderSettlementKeyIndex([o1], anchorMap)
  const s1 = settlementRecord({
    orderId: 'P798524075193091331',
    amountCent: 8800,
  })
  const matched1 = resolveSettlementRecordCanonicalOrderId(s1, index1)
  if (matched1 !== '798524075193091331') {
    fail(`packageId 结算未匹配 bizOrderId 订单: ${matched1}`)
    failures++
  } else {
    ok('orderId=业务单号 + 结算 packageId=P单号 → 匹配')
  }

  console.log('\n=== 3. displayOrderNo + SETTLE_NO / PACKAGE_ID ===')
  const o2 = order({
    sourceRowIndex: 2,
    orderId: '999',
    packageId: '',
    matchOrderId: 'P798440490066093751',
    displayOrderNo: 'P798440490066093751',
    officialOrderNo: 'P798440490066093751',
  })
  const index2 = buildOrderSettlementKeyIndex([o2], new Map([['P798440490066093751', 'anchor-a']]))
  const s2 = settlementRecord({
    orderId: '798440490066093751',
    raw: {
      settleBill: [
        { code: 'SETTLE_NO', value: '798440490066093751' },
        { code: 'PACKAGE_ID', value: 'P798440490066093751' },
      ],
    },
  })
  if (!resolveSettlementRecordCanonicalOrderId(s2, index2)) {
    fail('SETTLE_NO / PACKAGE_ID 未匹配 displayOrderNo')
    failures++
  } else {
    ok('displayOrderNo=P单号 + 结算 SETTLE_NO/PACKAGE_ID → 匹配')
  }

  console.log('\n=== 4. 不相关结算 → settlementWithoutOrder ===')
  const unrelated = settlementRecord({ orderId: 'P-UNRELATED-999', amountCent: 100 })
  const maps = buildSettlementMaps(
    {
      pendingRecords: [],
      settledRecords: [s1, unrelated],
      abnormalPendingRecords: [],
      abnormalSettledRecords: [],
    },
    index1,
  )
  if (maps.billUnmatchedCount !== 1) {
    fail(`billUnmatchedCount=${maps.billUnmatchedCount}，期望 1`)
    failures++
  } else {
    ok('不相关结算仍计 settlementWithoutOrder')
  }

  console.log('\n=== 5. 匹配后主播 settled 归属 ===')
  const anchorBucket = maps.byAnchor.get('anchor-xiaoyi')
  if (!anchorBucket || anchorBucket.settledIncomeCent !== 8800) {
    fail(`主播 settled=${anchorBucket?.settledIncomeCent ?? 0}，期望 8800`)
    failures++
  } else {
    ok('匹配后主播 settled 金额归属正确')
  }

  console.log('\n=== 6. data-validation settlementReconciliation ===')
  const recon = checkSettlementReconciliation({
    orders: [o1],
    anchorByMatchOrderId: anchorMap,
    settlement: {
      pendingRecords: [],
      settledRecords: [s1, unrelated],
      abnormalPendingRecords: [],
      abnormalSettledRecords: [],
    },
    views: [],
  })
  if (recon.settledMatchedCount !== 1 || recon.settlementWithoutOrderCount !== 1) {
    fail(
      `recon settled=${recon.settledMatchedCount} withoutOrder=${recon.settlementWithoutOrderCount}`,
    )
    failures++
  } else {
    ok('checkSettlementReconciliation 使用同一 key 池')
  }

  const orderKeys = collectOrderSettlementMatchKeys(o1)
  const settleKeys = collectSettlementRecordMatchKeys(s1)
  const overlap = orderKeys.filter((k) => settleKeys.includes(k))
  if (overlap.length === 0) {
    fail('订单/结算 key 池无交集')
    failures++
  } else {
    ok(`key 池交集 ${overlap.length} 个`)
  }

  if (failures > 0) {
    console.log(`\nFAIL (${failures} 项)`)
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
