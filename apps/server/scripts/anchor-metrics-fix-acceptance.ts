/**
 * 主播业绩 / 签收额修复验收（纯函数 + 可选本地 DB 上月核验）
 * 用法: npx tsx apps/server/scripts/anchor-metrics-fix-acceptance.ts
 */
import type { AnchorConfig, AnalyzedOrderView, NormalizedOrder, TimeRule } from '../src/types/analysis'
import {
  isTimeRuleEffectiveAt,
  LEGACY_ANCHOR_CUTOFF_MS,
  matchTimeRule,
} from '../src/services/anchor-rules.service'
import {
  ANCHOR_SESSION_DISPLAY_FROM_0613,
  isReportDateOnOrAfterShopSessionCutoff,
  isXiaoBaiAttributionActive,
  isInXiaoBaiOrderSlot,
  isReportDateOnOrAfterXiaoBaiCutoff,
  resolveDailyReportAnchorsForDate,
  sessionOverlapsXiaoBaiSlot,
  computeXiaoBaiSlotOverlapMinutes,
  computeMorningPortionBeforeXiaoBaiSlotMinutes,
  normalizeShopSessionKey,
  remapViewsForAnchorPerformance,
  resolveAnchorForPerformanceAttribution,
  resolveLiveSessionPeriod,
  resolveShopSessionAnchorName,
  ensureAnchorPerformanceLeaderboardSlots,
  SHOP_SESSION_ANCHOR_CUTOFF_MS,
  XIAOBAI_ANCHOR_CUTOFF_MS,
} from '../src/services/anchor-performance-attribution.service'
import {
  filterViewsForCoreMetrics,
  isExcludedFromCoreMetrics,
} from '../src/services/metrics-exclusion.service'
import {
  isLowPriceBrushOrderView,
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
  resolvePaymentBaseCentForBrushCheck,
} from '../src/services/low-price-brush-order.service'
import {
  getActualSignAmountCent,
  isEffectiveSignedOrder,
  orderQualifiesForActualSignedAfterSale,
  ACTUAL_SIGNED_MAX_PRODUCT_REFUND_CENT,
} from '../src/services/strict-after-sale-metrics.service'
import {
  isFreightOnlyBoardRefundCent,
  resolveSuccessfulProductRefundCentForSign,
} from '../src/services/sign-amount-refund.service'
import { isFreightOnlyRefund, FREIGHT_REFUND_CENT } from '../src/services/business-refund-caliber.service'
import { pickPaymentTimeText, hasPaymentTimeText } from '../src/utils/order-payment-time.util'
import { isStatusSignedFromTexts } from '../src/services/order-sign-status.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    matchOrderId: 'm1',
    orderTimeText: '2026-05-01 10:00:00',
    buyerId: 'u1',
    anchorId: 'a1',
    anchorName: '子杰',
    liveAccountId: 'la1',
    liveAccountName: '主店',
    attributionType: 'time_rule',
    gmvCent: 0,
    productAmountCent: 0,
    receivableAmountCent: 0,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 0,
    actualSellerReceiveAmountCent: 0,
    actualSignedAmountCent: 0,
    orderStatusText: '已完成',
    afterSaleStatusText: '—',
    isSigned: true,
    isReturned: false,
    isActualSigned: false,
    isReturnRefundOrder: false,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    buyerProductRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: false,
    effectiveGmvCent: 0,
    paymentBaseCent: 0,
    includedInGmv: true,
    ...partial,
  }
}

function testAnchorRuleEffectiveFrom(issues: string[]) {
  const xiaoHongRule: TimeRule = {
    id: 'r-xh',
    name: '小红 14:40-18:00',
    startTime: '14:40',
    endTime: '18:00',
    anchorId: 'anchor-xh',
    enabled: true,
    effectiveFromMs: Date.parse('2026-06-08T10:00:00+08:00'),
  }
  const config: AnchorConfig = {
    anchors: [{ id: 'anchor-xh', name: '小红', color: '#000', enabled: true }],
    timeRules: [xiaoHongRule],
  }
  const mayPay = new Date('2026-05-14T15:00:00+08:00')
  const junePay = new Date('2026-06-08T15:00:00+08:00')
  assert(matchTimeRule(mayPay, config) == null, '2026-05 支付不应命中小红规则', issues)
  assert(matchTimeRule(junePay, config)?.anchor.name === '小红', '2026-06-08 后应命中小红', issues)
  assert(
    isTimeRuleEffectiveAt(xiaoHongRule, mayPay) === false,
    '规则生效时间应阻止历史订单',
    issues,
  )
  const legacyRule: TimeRule = {
    ...xiaoHongRule,
    id: 'legacy',
    effectiveFromMs: null,
  }
  assert(
    matchTimeRule(mayPay, { ...config, timeRules: [legacyRule] })?.anchor.name === '小红',
    'legacy 规则（effectiveFrom=null）仍匹配历史',
    issues,
  )
  assert(LEGACY_ANCHOR_CUTOFF_MS > 0, 'legacy cutoff 常量应存在', issues)
}

function testShopSessionAnchorRules(issues: string[]) {
  const config: AnchorConfig = {
    anchors: [
      { id: 'anchor-zijie', name: '子杰', color: '#000', enabled: true },
      { id: 'anchor-feiyun', name: '飞云', color: '#000', enabled: true },
      { id: 'anchor-xh', name: '小红', color: '#000', enabled: true },
      { id: 'anchor-xy', name: '小艺', color: '#000', enabled: true },
    ],
    timeRules: [],
  }

  assert(
    isReportDateOnOrAfterShopSessionCutoff('2026-06-13'),
    '6.13 应启用店铺场次规则',
    issues,
  )
  assert(
    !isReportDateOnOrAfterShopSessionCutoff('2026-06-12'),
    '6.12 仍走历史时间段规则',
    issues,
  )
  assert(SHOP_SESSION_ANCHOR_CUTOFF_MS > 0, '店铺场次切换日应存在', issues)

  const june13Morning = new Date('2026-06-13T10:00:00+08:00')
  const june13Evening = new Date('2026-06-13T20:00:00+08:00')
  assert(normalizeShopSessionKey('xy祥钰珠宝') === 'xiangyu', '祥钰店铺识别', issues)
  assert(normalizeShopSessionKey('和田雅玉') === 'hetian', '和田雅玉识别', issues)
  assert(normalizeShopSessionKey('拾玉居') === 'shiyu', '拾玉居识别', issues)
  assert(resolveLiveSessionPeriod(june13Morning) === 'morning', '10 点属早场', issues)
  assert(resolveLiveSessionPeriod(june13Evening) === 'evening', '20 点属晚场', issues)

  assert(
    resolveShopSessionAnchorName('xiangyu', 'morning') === '子杰',
    '早场祥钰→子杰',
    issues,
  )
  assert(
    resolveShopSessionAnchorName('hetian', 'morning') === '小红',
    '早场和田雅玉→小红',
    issues,
  )
  assert(
    resolveShopSessionAnchorName('shiyu', 'evening') === '飞云',
    '晚场拾玉居→飞云',
    issues,
  )
  assert(
    resolveShopSessionAnchorName('hetian', 'evening') === '小艺',
    '晚场和田雅玉→小艺',
    issues,
  )

  const beforeCutoff = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: '和田雅玉',
      orderTimeText: '2026-06-12 10:00:00',
    }),
    config,
  )
  assert(beforeCutoff.anchorName === '子杰', '6.12 前保留原归属', issues)

  const afterMorning = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: '和田雅玉',
      orderTimeText: '2026-06-13 10:00:00',
    }),
    config,
  )
  assert(afterMorning.anchorName === '小红', '6.13 早场和田雅玉→小红', issues)

  const afterEvening = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '飞云',
      liveAccountName: '拾玉居',
      orderTimeText: '2026-06-13 20:00:00',
    }),
    config,
  )
  assert(afterEvening.anchorName === '飞云', '6.13 晚场拾玉居→飞云', issues)

  const remapped = remapViewsForAnchorPerformance([
    makeView({
      anchorName: '子杰',
      liveAccountName: 'xy祥钰珠宝',
      orderTimeText: '2026-06-13 09:00:00',
    }),
  ])
  assert(remapped[0]?.anchorName === '子杰', '早场祥钰仍归子杰', issues)

  const emptySlots = ensureAnchorPerformanceLeaderboardSlots([], '2026-06-13')
  assert(emptySlots.some((r) => r.anchorName === '小红'), '6.13 起应展示小红空行', issues)
  assert(emptySlots.some((r) => r.anchorName === '小艺'), '6.13 起应展示小艺空行', issues)
  assert(emptySlots.length === 4, '6.13 起应固定展示四人', issues)

  const emptySlots618 = ensureAnchorPerformanceLeaderboardSlots([], '2026-06-18')
  assert(
    ANCHOR_SESSION_DISPLAY_FROM_0613['小白']?.shopName === 'XY祥钰珠宝',
    '小白归属店铺应为 XY祥钰珠宝',
    issues,
  )

  assert(emptySlots618.some((r) => r.anchorName === '小白'), '6.18 起应展示小白空行', issues)
  assert(emptySlots618.length === 5, '6.18 起应固定展示五人', issues)

  assert(
    isReportDateOnOrAfterXiaoBaiCutoff('2026-06-18'),
    '6.18 应启用小白时段规则',
    issues,
  )
  assert(
    !isReportDateOnOrAfterXiaoBaiCutoff('2026-06-17'),
    '6.17 不应启用小白时段规则',
    issues,
  )
  assert(XIAOBAI_ANCHOR_CUTOFF_MS > SHOP_SESSION_ANCHOR_CUTOFF_MS, '小白规则应晚于店铺场次规则', issues)

  const june17Afternoon = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: '和田雅玉',
      orderTimeText: '2026-06-17 15:00:00',
    }),
    config,
  )
  assert(june17Afternoon.anchorName === '小红', '6.17 15:00 和田雅玉仍归小红', issues)

  const june18Afternoon = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: '和田雅玉',
      orderTimeText: '2026-06-18 15:00:00',
    }),
    config,
  )
  assert(june18Afternoon.anchorName === '小红', '6.18 15:00 和田雅玉仍归小红', issues)

  const june18XiangyuAfternoon = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: 'XY祥钰珠宝',
      orderTimeText: '2026-06-18 15:00:00',
    }),
    config,
  )
  assert(june18XiangyuAfternoon.anchorName === '小白', '6.18 15:00 祥钰应归小白', issues)

  const june18ShiyuAfternoon = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: '拾玉居',
      orderTimeText: '2026-06-18 16:03:00',
    }),
    config,
  )
  assert(june18ShiyuAfternoon.anchorName === '未归属', '6.18 16:03 拾玉居不应归小白', issues)

  const june18Morning = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: '和田雅玉',
      orderTimeText: '2026-06-18 10:00:00',
    }),
    config,
  )
  assert(june18Morning.anchorName === '小红', '6.18 10:00 仍归小红', issues)

  const june18EdgeStart = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '子杰',
      liveAccountName: 'xy祥钰珠宝',
      orderTimeText: '2026-06-18 14:30:00',
    }),
    config,
  )
  assert(june18EdgeStart.anchorName === '小白', '6.18 14:30 应归小白', issues)

  const june18EdgeEnd = resolveAnchorForPerformanceAttribution(
    makeView({
      anchorName: '飞云',
      liveAccountName: '拾玉居',
      orderTimeText: '2026-06-18 18:00:00',
    }),
    config,
  )
  assert(june18EdgeEnd.anchorName === '飞云', '6.18 18:00 拾玉居晚场应归飞云', issues)

  assert(isInXiaoBaiOrderSlot(new Date('2026-06-18T14:30:00+08:00')), '14:30 在小白时段内', issues)
  assert(isInXiaoBaiOrderSlot(new Date('2026-06-18T18:00:00+08:00')), '18:00 在小白时段内', issues)
  assert(!isInXiaoBaiOrderSlot(new Date('2026-06-18T18:01:00+08:00')), '18:01 不在小白时段内', issues)
  assert(
    isXiaoBaiAttributionActive(Date.parse('2026-06-18T15:00:00+08:00')),
    '6.18 15:00 应激活小白归属',
    issues,
  )
  assert(
    !isXiaoBaiAttributionActive(Date.parse('2026-06-17T15:00:00+08:00')),
    '6.17 15:00 不应激活小白归属',
    issues,
  )

  const reportAnchors618 = resolveDailyReportAnchorsForDate(config, '2026-06-18')
  assert(
    reportAnchors618.some((a) => a.anchorName === '小白'),
    '6.18 日报应包含小白',
    issues,
  )

  assert(
    sessionOverlapsXiaoBaiSlot(
      Date.parse('2026-06-18T09:00:00+08:00'),
      Date.parse('2026-06-18T15:00:00+08:00'),
    ),
    '早场跨到午后的场次应归小白时段',
    issues,
  )
  assert(
    !sessionOverlapsXiaoBaiSlot(
      Date.parse('2026-06-18T09:00:00+08:00'),
      Date.parse('2026-06-18T14:00:00+08:00'),
    ),
    '14:00 前结束的场次不应归小白',
    issues,
  )

  const crossStart = Date.parse('2026-06-18T09:51:00+08:00')
  const crossEnd = Date.parse('2026-06-18T16:07:00+08:00')
  assert(
    computeXiaoBaiSlotOverlapMinutes(crossStart, crossEnd) === 97,
    '跨场直播小白时长应仅为 14:30~下播（97 分钟）',
    issues,
  )
  assert(
    computeMorningPortionBeforeXiaoBaiSlotMinutes(crossStart, crossEnd) === 279,
    '跨场直播早场时长应仅为开播~14:30（279 分钟）',
    issues,
  )
  assert(
    computeXiaoBaiSlotOverlapMinutes(
      Date.parse('2026-06-18T14:30:00+08:00'),
      Date.parse('2026-06-18T18:00:00+08:00'),
    ) === 210,
    '纯午场 14:30~18:00 应为 210 分钟',
    issues,
  )
}

async function testLiveDurationDedup(issues: string[]) {
  const { sumUniqueLiveDurationMinutesForRange } = await import(
    '../src/services/anchor-live-sessions.service'
  )
  const total = await sumUniqueLiveDurationMinutesForRange({
    startDate: '2026-06-13',
    endDate: '2026-06-13',
  })
  if (total <= 0) {
    console.log('[skip] 本地无 6.13 直播场次，跳过时长去重核验')
    return
  }
  assert(total <= 1200, `6.13 直播总时长=${total}min 不应接近 24 小时`, issues)
  assert(total >= 900, `6.13 直播总时长=${total}min 应约为 4 场之和`, issues)
}

function testCoreMetricsLowPriceOnly(issues: string[]) {
  assert(
    !isExcludedFromCoreMetrics(
      makeView({ liveAccountName: '和田雅玉', paymentBaseCent: 5000 }),
    ),
    '和田雅玉正常价单不应因店铺名排除',
    issues,
  )
  assert(
    !isExcludedFromCoreMetrics(
      makeView({
        anchorName: '和田雅玉',
        liveAccountName: '主店',
        paymentBaseCent: 3000,
      }),
    ),
    '29 元以上主店订单应计入',
    issues,
  )
  assert(
    isExcludedFromCoreMetrics(makeView({ paymentBaseCent: 2100 })),
    '21 元低价单应排除',
    issues,
  )
  const kept = filterViewsForCoreMetrics([
    makeView({ liveAccountName: '主店', paymentBaseCent: 5000 }),
    makeView({ liveAccountName: '和田雅玉', paymentBaseCent: 1000 }),
  ])
  assert(kept.length === 1, '仅排除低价单，正常价单保留', issues)
}

function testLowPriceBrush(issues: string[]) {
  assert(LOW_PRICE_BRUSH_THRESHOLD_CENT === 2900, '阈值应为 2900 分', issues)
  assert(
    isLowPriceBrushOrderView(makeView({ paymentBaseCent: 2100 })),
    '21 元应视为低价刷单',
    issues,
  )
  assert(
    isLowPriceBrushOrderView(makeView({ paymentBaseCent: 2899 })),
    '28.99 元应视为低价刷单',
    issues,
  )
  assert(
    !isLowPriceBrushOrderView(makeView({ paymentBaseCent: 2900 })),
    '29 元不应视为低价刷单',
    issues,
  )
  assert(
    resolvePaymentBaseCentForBrushCheck(makeView({ paymentBaseCent: 2100 })) === 2100,
    '低价判断应基于 paymentBaseCent',
    issues,
  )
}

function testFreightRefundSignAmount(issues: string[]) {
  const cases: Array<{ pay: number; label: string }> = [
    { pay: 81700, label: '817元' },
    { pay: 21800, label: '218元' },
    { pay: 71700, label: '717元' },
    { pay: 69300, label: '693元' },
    { pay: 21700, label: '217元' },
    { pay: 135900, label: '1359元' },
  ]
  for (const c of cases) {
    const raw = {
      reason_name_zh: '退运费',
      applied_amount: 18,
      refund_fee: 18,
      pay_amount: c.pay / 100,
    }
    assert(isFreightOnlyRefund(raw, FREIGHT_REFUND_CENT), `${c.label} 18元退运费应识别为纯运费`, issues)
    const productRefund = resolveSuccessfulProductRefundCentForSign({
      afterSaleRecords: [],
      boardRefundAmountCent: FREIGHT_REFUND_CENT,
      paymentBaseCent: c.pay,
      orderRaw: raw,
    })
    assert(productRefund === 0, `${c.label} 签收扣款商品退款应为 0`, issues)
    const signed = getActualSignAmountCent({
      paymentBaseCent: c.pay,
      successfulRefundAmountCent: productRefund,
      statusSigned: true,
      includedInGmv: true,
    })
    assert(signed === c.pay, `${c.label} 签收额应等于支付基数`, issues)
  }

  const productRaw = {
    reason_name_zh: '多拍/拍错/不想要',
    applied_amount: 50,
    refund_fee: 50,
    refund_status_name: '退款成功',
    status_name: '已完成',
    refunded: true,
  }
  const productRefund = resolveSuccessfulProductRefundCentForSign({
    afterSaleRecords: [],
    boardRefundAmountCent: 5000,
    paymentBaseCent: 10000,
    orderRaw: productRaw,
  })
  assert(productRefund === 5000, '真实商品退款仍应扣签收额', issues)

  assert(
    isFreightOnlyBoardRefundCent(FREIGHT_REFUND_CENT, 81700, { reason_name_zh: '退运费' }),
    'board fallback 18元运费不应扣签收',
    issues,
  )
}

function testPaymentTimeExport(issues: string[]) {
  const pay = new Date('2026-05-10T14:30:00+08:00')
  const order: NormalizedOrder = {
    matchOrderId: 'm1',
    orderId: 'o1',
    packageId: 'p1',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    buyerId: 'u1',
    orderTimeText: '2026-05-10 10:00:00',
    paymentTime: pay,
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
    actualSignedAmountCent: 0,
    orderStatusText: '已完成',
    afterSaleStatusText: '—',
    isSigned: true,
    isReturned: false,
    isQualityReturn: false,
    actualSigned: false,
    sourceRowIndex: 1,
    errors: [],
    raw: {},
    liveAccountId: 'la1',
    liveAccountName: '主店',
  }
  const view = makeView({ matchOrderId: 'm1', paymentBaseCent: 10000 })
  const text = pickPaymentTimeText(view, order)
  assert(text !== '—', '有 paymentTime 时不应导出为 —', issues)
  assert(hasPaymentTimeText(view, order), 'hasPaymentTimeText 应为 true', issues)
}

function testSignStatusUnchanged(issues: string[]) {
  assert(isStatusSignedFromTexts('已完成'), '已完成仍算签收', issues)
  assert(!isStatusSignedFromTexts('已发货'), '已发货不算签收', issues)
  assert(!isStatusSignedFromTexts('待收货'), '待收货不算签收', issues)
  const signed = isEffectiveSignedOrder({
    includedInGmv: true,
    statusSigned: true,
    actualSignAmountCent: 100,
    qualifiesAfterSale: true,
  })
  assert(signed, '签收净额>0 且已签收应有效', issues)
}

function testActualSignedAfterSaleQualify(issues: string[]) {
  assert(
    orderQualifiesForActualSignedAfterSale({
      afterSaleRecords: [],
      successfulProductRefundCent: 0,
    }),
    '无售后应计入实际签收',
    issues,
  )
  assert(
    orderQualifiesForActualSignedAfterSale({
      afterSaleRecords: [],
      successfulProductRefundCent: ACTUAL_SIGNED_MAX_PRODUCT_REFUND_CENT,
      afterSaleClosedNoRefund: false,
    }),
    '商品退款 20 元应计入',
    issues,
  )
  assert(
    !orderQualifiesForActualSignedAfterSale({
      afterSaleRecords: [],
      successfulProductRefundCent: 5000,
    }),
    '商品退款 50 元不应计入实际签收',
    issues,
  )
  assert(
    orderQualifiesForActualSignedAfterSale({
      afterSaleRecords: [],
      successfulProductRefundCent: 0,
      afterSaleClosedNoRefund: true,
    }),
    '售后关闭无退款应计入',
    issues,
  )
  assert(
    !orderQualifiesForActualSignedAfterSale({
      afterSaleRecords: [],
      successfulProductRefundCent: 0,
      afterSaleStatusText: '售后中',
    }),
    '售后处理中不应计入',
    issues,
  )
  assert(
    !orderQualifiesForActualSignedAfterSale({
      afterSaleRecords: [],
      successfulProductRefundCent: 0,
      afterSaleStatusText: '售后完成',
    }),
    '售后完成且未核实退款不应计入实际签收',
    issues,
  )
  assert(
    orderQualifiesForActualSignedAfterSale({
      afterSaleRecords: [],
      successfulProductRefundCent: 0,
      afterSaleStatusText: '售后完成',
      resolvedRefundSource: 'after_sales_workbench_zero_refund',
    }),
    '售后完成且 API 确认零退款可计入',
    issues,
  )
}

async function verifyMayLiveDb(issues: string[]) {
  try {
    const { loadBoardArtifactsForRange } = await import('../src/services/board-metrics.service')
    const { aggregateAnchorLeaderboard } = await import('../src/services/board-metrics.service')
    const { attachRawByMatchToViews, filterViewsForAnchorPerformance } = await import(
      '../src/services/low-price-brush-order.service'
    )
    const { filterViewsForCoreMetrics } = await import('../src/services/metrics-exclusion.service')

    const { views, rawByMatch } = await loadBoardArtifactsForRange(
      'custom',
      '2026-05-01',
      '2026-05-31',
    )
    if (views.length === 0) {
      console.log('[skip] 本地无 2026-05 订单，跳过 live DB 核验')
      return
    }
    const coreViews = filterViewsForCoreMetrics(views)
    const perfViews = filterViewsForAnchorPerformance(
      attachRawByMatchToViews(coreViews, rawByMatch),
    )
    const rows = aggregateAnchorLeaderboard(perfViews)
    const byName = (name: string) => rows.find((r) => r.anchorName === name)
    const zijie = byName('子杰')?.actualSignedAmount ?? 0
    const feiyun = byName('飞云')?.actualSignedAmount ?? 0
    const xiaohong = byName('小红')?.actualSignedAmount ?? 0
    const hetian = byName('和田雅玉')?.actualSignedAmount ?? 0
    const total = rows.reduce((s, r) => s + (r.actualSignedAmount ?? 0), 0)

    const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol
    // 子杰与合计允许 ±120 元容差：低价刷单排除 + 实际签收仅含无售后/取消/退款≤20元订单
    const nearLive = (a: number, b: number, tol = 120) => Math.abs(a - b) <= tol
    if (!near(xiaohong, 0)) issues.push(`live: 小红签收额=${xiaohong} 期望 0`)
    if (!nearLive(zijie, 30550.9)) issues.push(`live: 子杰签收额=${zijie} 期望 30550.90`)
    if (!near(feiyun, 41782.7)) issues.push(`live: 飞云签收额=${feiyun} 期望 41782.70`)
    if (!nearLive(total, 72333.6)) issues.push(`live: 主播合计=${total} 期望 72333.60`)

    console.log('[live-db]', {
      子杰: zijie,
      飞云: feiyun,
      小红: xiaohong,
      和田雅玉: hetian,
      合计: total,
    })
  } catch (e) {
    console.log('[skip] live DB 核验跳过:', e instanceof Error ? e.message : e)
  }
}

async function main() {
  const issues: string[] = []
  testAnchorRuleEffectiveFrom(issues)
  testShopSessionAnchorRules(issues)
  await testLiveDurationDedup(issues)
  testCoreMetricsLowPriceOnly(issues)
  testLowPriceBrush(issues)
  testFreightRefundSignAmount(issues)
  testPaymentTimeExport(issues)
  testSignStatusUnchanged(issues)
  testActualSignedAfterSaleQualify(issues)
  await verifyMayLiveDb(issues)

  if (issues.length > 0) {
    console.error('anchor-metrics-fix-acceptance FAILED:')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('anchor-metrics-fix-acceptance OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
