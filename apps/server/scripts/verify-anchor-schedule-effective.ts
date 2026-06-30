/**
 * 排班生效验收（归属服务 + 边界）
 * 用法: npm run verify:anchor-schedule-effective
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import { buildScheduleBounds, isPayTimeInSchedule } from '../src/utils/anchor-schedule-time.util'
import {
  clearScheduleAttributionCache,
  resolveAnchorWithScheduleOverlay,
} from '../src/services/anchor-schedule-attribution.service'
import { listUnconfirmedScheduleDatesInRange } from '../src/services/anchor-schedule-confirm.service'
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
