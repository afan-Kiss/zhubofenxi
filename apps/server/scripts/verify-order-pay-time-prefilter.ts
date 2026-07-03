/**
 * 支付时间预筛验收：下单早、支付在范围内不应被漏掉
 */
import { orderPayTimeInRange } from '../src/utils/order-stat-time.util'
import type { NormalizedOrder } from '../src/types/analysis'
import type { DateRangeResolved } from '../src/utils/date-range'

const RAW_ORDER_RANGE_DB_BUFFER_MS = 30 * 24 * 60 * 60 * 1000

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function buildOrderTimeDbWhere(range: DateRangeResolved) {
  return {
    OR: [
      {
        orderTime: {
          gte: new Date(range.startTimeMs - RAW_ORDER_RANGE_DB_BUFFER_MS),
          lte: new Date(range.endTimeMs + RAW_ORDER_RANGE_DB_BUFFER_MS),
        },
      },
      { orderTime: null },
    ],
  }
}

function orderPassesDbPrefilter(orderTime: Date | null, range: DateRangeResolved): boolean {
  const where = buildOrderTimeDbWhere(range)
  const or = where.OR as Array<{ orderTime?: { gte: Date; lte: Date } | null }>
  if (orderTime == null) return or.some((clause) => clause.orderTime == null)
  const clause = or.find((c) => c.orderTime && 'gte' in c.orderTime)
  if (!clause?.orderTime || !('gte' in clause.orderTime)) return false
  const { gte, lte } = clause.orderTime
  return orderTime >= gte && orderTime <= lte
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
  const range: DateRangeResolved = {
    startDate: '2026-06-10',
    endDate: '2026-06-20',
    startTimeMs: Date.parse('2026-06-10T00:00:00+08:00'),
    endTimeMs: Date.parse('2026-06-20T23:59:59.999+08:00'),
  }

  const orderedEarly = new Date('2026-05-28T10:00:00+08:00')
  const paidInRange = new Date('2026-06-15T14:00:00+08:00')
  const orderEarlyPayIn = mockOrder({ orderTime: orderedEarly, paymentTime: paidInRange })

  assert(
    orderPassesDbPrefilter(orderedEarly, range),
    '下单比范围早 10 天、支付在范围内：DB 预筛不应漏掉',
    issues,
  )
  assert(orderPayTimeInRange(orderEarlyPayIn, range), '支付时间在范围内应计入', issues)

  const orderedInRange = new Date('2026-06-12T10:00:00+08:00')
  const paidOutOfRange = new Date('2026-06-25T10:00:00+08:00')
  const orderInPayOut = mockOrder({ orderTime: orderedInRange, paymentTime: paidOutOfRange })
  assert(!orderPayTimeInRange(orderInPayOut, range), '支付不在范围内不应计入', issues)

  if (issues.length) {
    console.error('[verify:order-pay-time-prefilter] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:order-pay-time-prefilter] PASS')
}

run()
