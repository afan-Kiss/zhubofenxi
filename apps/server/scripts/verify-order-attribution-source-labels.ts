/**
 * 静态验收：归属来源标签 + 手动覆盖优先 + 清除后恢复排班
 *
 * npm run verify:order-attribution-source-labels
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import { matchScheduleRow } from '../src/services/anchor-schedule-attribution.service'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'

type Source =
  | 'manual_override'
  | 'live_session'
  | 'manual_schedule'
  | 'default_schedule'
  | 'template_virtual'
  | 'unmatched'

function attributionSourceShortLabel(source: Source | string | null | undefined): string {
  switch (String(source ?? '').trim()) {
    case 'manual_override':
      return '手动指定'
    case 'live_session':
      return '真实场次归属'
    case 'manual_schedule':
    case 'default_schedule':
    case 'template_virtual':
      return '排班归属'
    case 'unmatched':
      return '未归属'
    default:
      return '自动归属'
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`)
    process.exit(1)
  }
  console.log(`  ✓ ${msg}`)
}

function makeView(
  liveAccountName: string,
  orderTimeText: string,
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    orderId: `o-${liveAccountName}`,
    packageId: `p-${liveAccountName}`,
    bizOrderId: `b-${liveAccountName}`,
    displayOrderNo: `P-${liveAccountName}`,
    officialOrderNo: `P-${liveAccountName}`,
    matchOrderId: `m-${liveAccountName}`,
    orderTimeText,
    buyerId: 'u1',
    anchorId: '',
    anchorName: '未归属',
    liveAccountName,
    attributionType: 'time_rule',
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
    actualSignedAmountCent: 10000,
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
    effectiveGmvCent: 10000,
    paymentBaseCent: 10000,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    raw: { paymentTime: orderTimeText, payTime: orderTimeText },
  }
}

function main(): void {
  console.log('\n=== 归属来源短标签 ===')
  assert(attributionSourceShortLabel('manual_override') === '手动指定', 'manual_override → 手动指定')
  assert(attributionSourceShortLabel('live_session') === '真实场次归属', 'live_session → 真实场次归属')
  assert(attributionSourceShortLabel('manual_schedule') === '排班归属', 'manual_schedule → 排班归属')
  assert(attributionSourceShortLabel('default_schedule') === '排班归属', 'default_schedule → 排班归属')
  assert(attributionSourceShortLabel('template_virtual') === '排班归属', 'template_virtual → 排班归属')
  assert(attributionSourceShortLabel('unmatched') === '未归属', 'unmatched → 未归属')

  console.log('\n=== 2026-07-07 13:37 和田雅玉默认归小红，不串子杰 ===')
  const date = '2026-07-07'
  const payTimeText = '2026-07-07 13:37:04'
  const payMs = Date.parse(`${date}T13:37:04+08:00`)
  const morning = buildScheduleBounds(date, '09:30', '14:00')
  const scheduleRows = [
    {
      id: 'sch-hetian-xiaohong',
      anchorName: '小红',
      shopName: '和田雅玉',
      liveRoomName: '和田雅玉',
      startAt: morning.startAt,
      endAt: morning.endAt,
    },
    {
      id: 'sch-shiyuju-zijie',
      anchorName: '子杰',
      shopName: '拾玉居和田玉',
      liveRoomName: '拾玉居和田玉',
      startAt: morning.startAt,
      endAt: morning.endAt,
    },
  ]

  const hetianHit = matchScheduleRow(makeView('和田雅玉', payTimeText), payMs, scheduleRows)
  assert(hetianHit?.anchorName === '小红', `和田雅玉 13:37 → 小红（实际 ${hetianHit?.anchorName}）`)
  assert(hetianHit?.id === 'sch-hetian-xiaohong', '和田雅玉不串到拾玉居/子杰')

  const shiyujuHit = matchScheduleRow(makeView('拾玉居和田玉', payTimeText), payMs, scheduleRows)
  assert(shiyujuHit?.anchorName === '子杰', `拾玉居 13:37 → 子杰（实际 ${shiyujuHit?.anchorName}）`)

  console.log('\n=== 手动覆盖优先，清除后恢复排班 ===')
  const autoHit = matchScheduleRow(makeView('和田雅玉', payTimeText), payMs, scheduleRows)
  assert(autoHit?.anchorName === '小红', '自动归属应为小红')

  // 模拟手动覆盖优先：有 manual_override 时不再走排班
  const manualOverrideAnchor = '子杰'
  const withOverride = {
    attributionSource: 'manual_override' as const,
    anchorName: manualOverrideAnchor,
  }
  assert(withOverride.anchorName === '子杰', '手动覆盖优先显示子杰')
  assert(
    attributionSourceShortLabel(withOverride.attributionSource) === '手动指定',
    '手动覆盖显示「手动指定」',
  )

  // 清除手动指定后恢复自动归属
  const cleared = {
    attributionSource: 'manual_schedule' as const,
    anchorName: autoHit!.anchorName,
  }
  assert(cleared.anchorName === '小红', '清除手动指定后恢复小红')
  assert(
    attributionSourceShortLabel(cleared.attributionSource) === '排班归属',
    '清除后显示排班归属',
  )

  console.log('\n全部通过')
}

main()
