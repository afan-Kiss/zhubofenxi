/**
 * 每日主播排班验收
 * 用法: npm run verify:anchor-schedules
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  buildScheduleBounds,
  detectScheduleConflicts,
  isPayTimeInSchedule,
} from '../src/utils/anchor-schedule-time.util'
import {
  DEFAULT_SCHEDULE_TEMPLATE_SEEDS,
  templateAppliesOnDate,
  XIAOBAI_SCHEDULE_START_DATE,
} from '../src/services/anchor-schedule-template.service'
import { validateScheduleDraft } from '../src/services/anchor-schedule-template.service'
import { resolveAnchorWithScheduleOverlay, clearScheduleAttributionCache } from '../src/services/anchor-schedule-attribution.service'

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

  const xbTemplate = DEFAULT_SCHEDULE_TEMPLATE_SEEDS.find((t) => t.anchorName === '小白')!
  assert(
    !templateAppliesOnDate(xbTemplate, '2026-06-17'),
    '小白 2026-06-18 前不应生成默认排班',
    issues,
  )
  assert(
    templateAppliesOnDate(xbTemplate, XIAOBAI_SCHEDULE_START_DATE),
    '小白 2026-06-18 起应生效',
    issues,
  )

  const { startAt: xbStart, endAt: xbEnd } = buildScheduleBounds(
    '2026-06-20',
    '14:30',
    '18:00',
  )
  const pay1430 = Date.parse('2026-06-20T14:30:00+08:00')
  const pay1429 = Date.parse('2026-06-20T14:29:59+08:00')
  assert(isPayTimeInSchedule(pay1430, xbStart, xbEnd), '14:30 应命中小白时段', issues)
  assert(!isPayTimeInSchedule(pay1429, xbStart, xbEnd), '14:29 不应命中小白时段', issues)

  const { startAt: zjStart, endAt: zjEnd } = buildScheduleBounds('2026-06-20', '00:00', '14:30')
  assert(isPayTimeInSchedule(pay1429, zjStart, zjEnd), '14:29 应归子杰早场', issues)
  assert(!isPayTimeInSchedule(pay1430, zjStart, zjEnd), '14:30 不应重复归子杰', issues)

  const overlap = detectScheduleConflicts([
    {
      anchorName: '子杰',
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      ...buildScheduleBounds('2026-06-20', '14:00', '15:00'),
    },
    {
      anchorName: '小白',
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      ...buildScheduleBounds('2026-06-20', '14:30', '18:00'),
    },
  ])
  assert(overlap.length > 0, '同店铺重叠应检测冲突', issues)

  const anchorOverlap = detectScheduleConflicts([
    {
      anchorName: '小白',
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      ...buildScheduleBounds('2026-06-20', '14:00', '16:00'),
    },
    {
      anchorName: '小白',
      shopName: '和田雅玉',
      liveRoomName: '和田雅玉',
      ...buildScheduleBounds('2026-06-20', '15:00', '17:00'),
    },
  ])
  assert(anchorOverlap.length > 0, '同主播跨直播间重叠应冲突', issues)

  const draftOk = validateScheduleDraft('2026-06-20', [
    {
      anchorName: '子杰',
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      startTime: '00:00',
      endTime: '14:30',
    },
    {
      anchorName: '小白',
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      startTime: '14:30',
      endTime: '18:00',
    },
  ])
  assert(draftOk.ok, '合法排班应通过校验', issues)

  clearScheduleAttributionCache()
  const viewXb = makeView({
    orderTimeText: '2026-06-20 15:00:00',
    raw: { payTime: '2026-06-20 15:00:00' },
    liveAccountName: 'XY祥钰珠宝',
  })
  const resolved = await resolveAnchorWithScheduleOverlay(viewXb)
  assert(
    resolved.anchorName === '小白' &&
      (resolved.attributionSource === 'live_session' ||
        resolved.attributionSource === 'default_schedule' ||
        resolved.attributionSource === 'template_virtual'),
    `应归小白（真实直播或排班回退），实际=${resolved.anchorName}/${resolved.attributionSource}`,
    issues,
  )

  if (issues.length) {
    console.error('verify:anchor-schedules FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:anchor-schedules OK')
}

void run()
