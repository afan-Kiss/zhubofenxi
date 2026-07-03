/**
 * 支付时间预筛验收（纯函数 + 晚支付漏单场景）
 * 用法: npm run verify:order-pay-time-prefilter
 */
import type { NormalizedOrder } from '../src/types/analysis'
import type { DateRangeResolved } from '../src/utils/date-range'
import { orderPayTimeInRange } from '../src/utils/order-stat-time.util'
import { RAW_ORDER_RANGE_DB_BUFFER_MS } from '../src/services/xhs-api-sync/xhs-json-normalizer.service'
import {
  analyzePayTimePrefilterGaps,
  wouldOrderPassCurrentDbPrefilter,
} from '../src/services/order-pay-time-prefilter-diagnostic.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockOrder(partial: Partial<NormalizedOrder>): NormalizedOrder {
  return {
    packageId: 'p1',
    orderId: 'o1',
    orderNo: 'o1',
    gmvCent: 10000,
    errors: [],
    orderedAt: null,
    orderTime: null,
    paymentTime: null,
    buyerId: 'b1',
    buyerKey: 'b1',
    anchorName: '测试',
    liveAccountName: '测试店',
    ...partial,
  } as NormalizedOrder
}

function run(): void {
  const issues: string[] = []

  const shortRange: DateRangeResolved = {
    startDate: '2026-06-10',
    endDate: '2026-06-20',
    startTimeMs: Date.parse('2026-06-10T00:00:00+08:00'),
    endTimeMs: Date.parse('2026-06-20T23:59:59.999+08:00'),
  }

  const orderedEarly = new Date('2026-05-28T10:00:00+08:00')
  const paidInRange = new Date('2026-06-15T14:00:00+08:00')
  const orderEarlyPayIn = mockOrder({
    packageId: 'p-short',
    orderTime: orderedEarly,
    orderedAt: orderedEarly,
    paymentTime: paidInRange,
  })

  assert(
    wouldOrderPassCurrentDbPrefilter(orderedEarly, shortRange),
    '下单比范围早 10 天、支付在范围内：DB 预筛不应漏掉',
    issues,
  )
  assert(orderPayTimeInRange(orderEarlyPayIn, shortRange), '支付时间在范围内应计入', issues)

  const orderedInRange = new Date('2026-06-12T10:00:00+08:00')
  const paidOutOfRange = new Date('2026-06-25T10:00:00+08:00')
  const orderInPayOut = mockOrder({ orderTime: orderedInRange, paymentTime: paidOutOfRange })
  assert(!orderPayTimeInRange(orderInPayOut, shortRange), '支付不在范围内不应计入', issues)

  assert(RAW_ORDER_RANGE_DB_BUFFER_MS === 30 * 24 * 60 * 60 * 1000, '预筛缓冲应为30天', issues)

  const juneRange: DateRangeResolved = {
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    startTimeMs: Date.parse('2026-06-01T00:00:00+08:00'),
    endTimeMs: Date.parse('2026-06-30T23:59:59.999+08:00'),
  }

  const latePayOrder = mockOrder({
    packageId: 'p-late',
    orderId: 'o-late',
    orderTime: new Date('2026-04-20T10:00:00+08:00'),
    orderedAt: new Date('2026-04-20T10:00:00+08:00'),
    paymentTime: new Date('2026-06-10T14:00:00+08:00'),
    gmvCent: 500000,
  })

  const gaps = analyzePayTimePrefilterGaps([latePayOrder], juneRange)
  assert(gaps.length === 1, `应识别1条晚支付订单，实际 ${gaps.length}`, issues)
  const row = gaps[0]
  assert(row != null && row.gapDays > 30, '下单与支付应相差超过30天', issues)
  assert(row?.paymentMonth === '2026-06', `支付月应为2026-06，实际 ${row?.paymentMonth}`, issues)
  assert(
    row?.wouldMissWithCurrentPrefilter === true,
    '2026-04-20下单、2026-06-10支付，核对6月时当前预筛应漏掉',
    issues,
  )
  assert(
    wouldOrderPassCurrentDbPrefilter(latePayOrder.orderTime!, juneRange) === false,
    'orderTime 不在6月±30天预筛范围',
    issues,
  )

  const stable = analyzePayTimePrefilterGaps([latePayOrder], juneRange)
  assert(
    stable[0]?.wouldMissWithCurrentPrefilter === true,
    '重复分析结果应一致',
    issues,
  )

  if (issues.length) {
    console.error('[verify:order-pay-time-prefilter] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:order-pay-time-prefilter] PASS')
}

run()
