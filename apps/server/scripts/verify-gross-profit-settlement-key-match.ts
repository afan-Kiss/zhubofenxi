/**
 * 总览毛利润结算 key 池匹配验收
 *
 * npm run verify:gross-profit-settlement-key-match
 */
import type { NormalizedOrder, SettlementRecord } from '../src/types/analysis'
import { computeGrossProfitBreakdown } from '../src/services/gross-profit.service'
import { buildOrderSettlementKeyIndex } from '../src/services/settlement-order-key-match.util'
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
  settlementType?: 'settled' | 'pending'
  amountCent?: number
  raw?: Record<string, unknown>
}): SettlementRecord {
  const normalized = normalizeSettlementItem(
    {
      packageId: params.raw?.packageId ?? params.orderId,
      settleNo: params.raw?.settleNo,
      settleBill: params.raw?.settleBill,
      ...params.raw,
    },
    params.settlementType ?? 'settled',
    1,
  )
  return {
    ...normalized,
    orderId: params.orderId,
    amountCent: params.amountCent ?? 8800,
    direction: 'income',
    raw: params.raw ?? {},
    errors: [],
  }
}

async function main(): Promise<void> {
  console.log('verify-gross-profit-settlement-key-match\n')
  let failures = 0

  const o1 = order({
    sourceRowIndex: 1,
    orderId: '798524075193091331',
    bizOrderId: '798524075193091331',
    packageId: 'P798524075193091331',
    matchOrderId: '798524075193091331',
    displayOrderNo: 'P798524075193091331',
    gmvCent: 10000,
  })
  const index = buildOrderSettlementKeyIndex([o1], new Map())
  const settled = settlementRecord({ orderId: 'P798524075193091331', amountCent: 8800 })

  console.log('=== 1. bizOrderId 订单 + P单号结算 ===')
  const gp1 = computeGrossProfitBreakdown(index, 10000, {
    pendingRecords: [],
    settledRecords: [settled],
    abnormalPendingRecords: [],
    abnormalSettledRecords: [],
  })
  if (gp1.matchedSettlementCount !== 1) {
    fail(`matchedSettlementCount 应为 1，实际 ${gp1.matchedSettlementCount}`)
    failures++
  } else {
    ok('matchedSettlementCount=1')
  }
  if (gp1.nonCurrentSettlementCount !== 0) {
    fail(`nonCurrentSettlementCount 应为 0，实际 ${gp1.nonCurrentSettlementCount}`)
    failures++
  } else {
    ok('nonCurrentSettlementCount=0')
  }
  if (gp1.grossProfitCent !== 8800) {
    fail(`grossProfitCent 应为 8800，实际 ${gp1.grossProfitCent}`)
    failures++
  } else {
    ok('grossProfitCent=8800 计入毛利润')
  }
  const sample1 = gp1.samples.find((s) => s.matchedOrder)
  if (!sample1?.matchedOrder) {
    fail('samples 应含 matchedOrder=true')
    failures++
  } else {
    ok(`samples matchedOrder=true (${sample1.packageId})`)
  }

  console.log('\n=== 2. settled + pending 同一 canonicalOrderId ===')
  const settled2 = settlementRecord({
    orderId: 'P798524075193091331',
    amountCent: 8800,
    raw: { settleNo: 'S-SETTLED-1' },
  })
  const pending2 = settlementRecord({
    orderId: 'P798524075193091331',
    settlementType: 'pending',
    amountCent: 5000,
    raw: { settleNo: 'S-PENDING-1' },
  })
  const gp2 = computeGrossProfitBreakdown(index, 10000, {
    pendingRecords: [pending2],
    settledRecords: [settled2],
    abnormalPendingRecords: [],
    abnormalSettledRecords: [],
  })
  if (gp2.matchedSettlementCount !== 1) {
    fail(`settled+pending 应只计 settled，matched=${gp2.matchedSettlementCount}`)
    failures++
  } else {
    ok('settled+pending 只计 settled，matchedSettlementCount=1')
  }
  if (gp2.duplicateSettlementCount < 1) {
    fail(`pending 重复应记 duplicate，实际 ${gp2.duplicateSettlementCount}`)
    failures++
  } else {
    ok(`pending 跳过 duplicateSettlementCount=${gp2.duplicateSettlementCount}`)
  }
  if (gp2.grossProfitCent !== 8800) {
    fail(`grossProfitCent 应只含 settled 8800，实际 ${gp2.grossProfitCent}`)
    failures++
  } else {
    ok('grossProfitCent 仅 settled 8800')
  }

  console.log('\n=== 3. 不相关结算不计入毛利润 ===')
  const unrelated = settlementRecord({
    orderId: 'P999999999999999999',
    amountCent: 6600,
    raw: { settleNo: 'S-UNRELATED' },
  })
  const gp3 = computeGrossProfitBreakdown(index, 10000, {
    pendingRecords: [],
    settledRecords: [unrelated],
    abnormalPendingRecords: [],
    abnormalSettledRecords: [],
  })
  if (gp3.matchedSettlementCount !== 0) {
    fail(`不相关结算 matched 应为 0，实际 ${gp3.matchedSettlementCount}`)
    failures++
  } else {
    ok('不相关结算 matchedSettlementCount=0')
  }
  if (gp3.nonCurrentSettlementCount !== 1) {
    fail(`不相关结算 nonCurrent 应为 1，实际 ${gp3.nonCurrentSettlementCount}`)
    failures++
  } else {
    ok('不相关结算 nonCurrentSettlementCount=1')
  }
  if (gp3.grossProfitCent !== 0) {
    fail(`不相关结算 grossProfitCent 应为 0，实际 ${gp3.grossProfitCent}`)
    failures++
  } else {
    ok('不相关结算 grossProfitCent=0')
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
