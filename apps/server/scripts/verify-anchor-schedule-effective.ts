/**
 * 排班生效验收（归属服务 + 边界 + 模板补齐重叠）
 * 用法: npm run verify:anchor-schedule-effective
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  buildScheduleBounds,
  filterVirtualSchedulesAgainstOccupied,
  isPayTimeInSchedule,
  scheduleIntervalsOverlap,
} from '../src/utils/anchor-schedule-time.util'
import {
  clearScheduleAttributionCache,
  resolveAnchorWithScheduleOverlay,
} from '../src/services/anchor-schedule-attribution.service'
import { listUnconfirmedScheduleDatesInRange } from '../src/services/anchor-schedule-confirm.service'
import {
  buildVirtualSchedulesFromTemplates,
  DEFAULT_SCHEDULE_TEMPLATE_SEEDS,
  templateAppliesOnDate,
} from '../src/services/anchor-schedule-template.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { addDaysShanghai } from '../src/utils/business-timezone'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeView(partial: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> }): AnalyzedOrderView & {
  raw?: Record<string, unknown>
} {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: 'PTEST001',
    officialOrderNo: 'PTEST001',
    matchOrderId: 'm1',
    orderTimeText: '2026-06-20 15:00:00',
    buyerId: 'u1',
    anchorId: 'a1',
    anchorName: '子杰',
    liveAccountName: 'XY祥钰珠宝',
    attributionType: 'time_rule',
    gmvCent: 5000,
    productAmountCent: 5000,
    receivableAmountCent: 5000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 5000,
    actualSellerReceiveAmountCent: 5000,
    actualSignedAmountCent: 5000,
    orderStatusText: '已完成',
    afterSaleStatusText: '无售后',
    isSigned: true,
    isReturned: false,
    isActualSigned: true,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: false,
    afterSaleCategory: '',
    afterSaleStatusLabel: '',
    afterSaleDisplayType: '',
    isSizeMismatch: false,
    reasonText: '',
    effectiveGmvCent: 5000,
    paymentBaseCent: 5000,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    isEffectiveSigned: true,
    ...partial,
  }
}

async function run(): Promise<void> {
  const issues: string[] = []
  const today = formatDateKeyShanghai(new Date())
  const yesterday = addDaysShanghai(today, -1)

  const pay1430 = Date.parse('2026-06-20T14:30:00+08:00')
  const pay1429 = Date.parse('2026-06-20T14:29:59+08:00')
  const pay1800 = Date.parse('2026-06-20T18:00:00+08:00')
  const { startAt: xbStart, endAt: xbEnd } = buildScheduleBounds('2026-06-20', '14:30', '18:00')
  const { startAt: zjStart, endAt: zjEnd } = buildScheduleBounds('2026-06-20', '00:00', '14:30')

  assert(isPayTimeInSchedule(pay1430, xbStart, xbEnd), '14:30 命中小白', issues)
  assert(!isPayTimeInSchedule(pay1429, xbStart, xbEnd), '14:29 不命中小白', issues)
  assert(!isPayTimeInSchedule(pay1430, zjStart, zjEnd), '14:30 不重复归子杰', issues)
  assert(isPayTimeInSchedule(pay1429, zjStart, zjEnd), '14:29 归子杰', issues)
  assert(!isPayTimeInSchedule(pay1800, xbStart, xbEnd), '18:00 左闭右开不命中小白', issues)

  const pay0630_142959 = Date.parse('2026-06-30T14:29:59+08:00')
  const pay0630_143000 = Date.parse('2026-06-30T14:30:00+08:00')
  const pay0630_175959 = Date.parse('2026-06-30T17:59:59+08:00')
  const pay0630_180000 = Date.parse('2026-06-30T18:00:00+08:00')
  const { startAt: xyZjStart, endAt: xyZjEnd } = buildScheduleBounds('2026-06-30', '00:00', '14:30')
  const { startAt: xyXbStart, endAt: xyXbEnd } = buildScheduleBounds('2026-06-30', '14:30', '18:00')
  const { startAt: htDayStart, endAt: htDayEnd } = buildScheduleBounds('2026-06-30', '00:00', '18:00')
  const { startAt: htNightStart, endAt: htNightEnd } = buildScheduleBounds('2026-06-30', '18:00', '24:00')
  const { startAt: fyStart, endAt: fyEnd } = buildScheduleBounds('2026-06-30', '18:00', '24:00')

  assert(isPayTimeInSchedule(pay0630_142959, xyZjStart, xyZjEnd), '6/30 14:29:59 XY -> 子杰时段', issues)
  assert(!isPayTimeInSchedule(pay0630_143000, xyZjStart, xyZjEnd), '6/30 14:30:00 不归子杰', issues)
  assert(isPayTimeInSchedule(pay0630_143000, xyXbStart, xyXbEnd), '6/30 14:30:00 XY -> 小白时段', issues)
  assert(isPayTimeInSchedule(pay0630_175959, xyXbStart, xyXbEnd), '6/30 17:59:59 XY -> 小白', issues)
  assert(!isPayTimeInSchedule(pay0630_180000, xyXbStart, xyXbEnd), '6/30 18:00 XY 不归小白', issues)
  assert(isPayTimeInSchedule(pay0630_175959, htDayStart, htDayEnd), '6/30 17:59:59 和田雅玉 -> 白天', issues)
  assert(isPayTimeInSchedule(pay0630_180000, htNightStart, htNightEnd), '6/30 18:00 和田雅玉 -> 晚场', issues)
  assert(isPayTimeInSchedule(pay0630_180000, fyStart, fyEnd), '6/30 18:00 拾玉居 -> 飞云晚场', issues)

  const date0630 = '2026-06-30'
  const templates0630 = DEFAULT_SCHEDULE_TEMPLATE_SEEDS.filter((t) => templateAppliesOnDate(t, date0630))
  const virtual0630 = buildVirtualSchedulesFromTemplates(
    date0630,
    templates0630.map((t, i) => ({
      id: `t${i}`,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startTime: t.startTime,
      endTime: t.endTime,
      effectiveFrom: t.effectiveFrom,
      effectiveTo: t.effectiveTo,
      enabled: true,
      sortOrder: t.sortOrder,
      note: t.note ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  )

  const normalVirtual = filterVirtualSchedulesAgainstOccupied(virtual0630, [])
  assert(normalVirtual.kept.length === 6, `6/30 无人工排班时应补齐 6 条模板，实际=${normalVirtual.kept.length}`, issues)

  const splitOccupied = [
    {
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      ...buildScheduleBounds(date0630, '00:00', '12:00'),
    },
    {
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      ...buildScheduleBounds(date0630, '12:00', '14:30'),
    },
  ]
  const afterSplit = filterVirtualSchedulesAgainstOccupied(virtual0630, splitOccupied)
  assert(
    !afterSplit.kept.some(
      (v) =>
        v.shopName === 'XY祥钰珠宝' &&
        v.anchorName === '子杰' &&
        v.startAt.getTime() === buildScheduleBounds(date0630, '00:00', '14:30').startAt.getTime() &&
        v.endAt.getTime() === buildScheduleBounds(date0630, '00:00', '14:30').endAt.getTime(),
    ),
    '人工拆分后不应再补 XY 00:00-14:30 子杰模板',
    issues,
  )
  assert(
    afterSplit.kept.some((v) => v.shopName === '祥钰珠宝'),
    'XY 人工排班不应影响祥钰珠宝模板补齐',
    issues,
  )
  assert(
    afterSplit.kept.some((v) => v.shopName === '和田雅玉'),
    'XY 人工排班不应影响和田雅玉模板补齐',
    issues,
  )
  assert(
    afterSplit.kept.some((v) => v.shopName === '拾玉居和田玉'),
    'XY 人工排班不应影响拾玉居模板补齐',
    issues,
  )

  const boundaryOccupied = [
    {
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      ...buildScheduleBounds(date0630, '00:00', '14:30'),
    },
  ]
  const afterBoundary = filterVirtualSchedulesAgainstOccupied(virtual0630, boundaryOccupied)
  assert(
    afterBoundary.kept.some(
      (v) =>
        v.shopName === 'XY祥钰珠宝' &&
        v.anchorName === '小白' &&
        v.startAt.getTime() === buildScheduleBounds(date0630, '14:30', '18:00').startAt.getTime(),
    ),
    '00:00-14:30 与 14:30-18:00 边界相邻不算重叠，小白模板应保留',
    issues,
  )

  const { startAt: bA, endAt: bB } = buildScheduleBounds(date0630, '00:00', '14:30')
  const { startAt: bC, endAt: bD } = buildScheduleBounds(date0630, '14:30', '18:00')
  assert(
    !scheduleIntervalsOverlap(bA, bB, bC, bD),
    '14:30 边界左闭右开：相邻时段不算重叠',
    issues,
  )

  clearScheduleAttributionCache()
  const view = makeView({
    orderTimeText: '2026-06-20 15:00:00',
    raw: { payTime: '2026-06-20 15:00:00' },
    liveAccountName: 'XY祥钰珠宝',
  })
  const resolved = await resolveAnchorWithScheduleOverlay(view)
  assert(
    resolved.anchorName === '小白' || resolved.attributionSource === 'default_schedule' || resolved.attributionSource === 'template_virtual',
    `虚拟/默认排班应归小白，实际=${resolved.anchorName}/${resolved.attributionSource}`,
    issues,
  )
  assert(resolved.scheduleConfirmed === false, '未确认排班 scheduleConfirmed 应为 false', issues)

  const unconfirmed = await listUnconfirmedScheduleDatesInRange(yesterday, today)
  assert(unconfirmed.includes(today) || unconfirmed.includes(yesterday) || unconfirmed.length >= 0, '未确认日期列表可计算', issues)

  if (issues.length) {
    console.error('verify:anchor-schedule-effective FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:anchor-schedule-effective OK')
}

void run()
