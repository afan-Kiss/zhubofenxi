import ExcelJS from 'exceljs'
import {
  AMOUNT_FORMULA_VERSION,
  GMV_PAYMENT_FIELD_NOTE,
} from './order-amount-metrics.service'
import { BUSINESS_METRICS_VERSION, calculateBusinessMetrics } from './business-metrics.service'
import { aggregateAnchorLeaderboard, normalizeBoardPreset } from './board-metrics.service'
import { getBuyerRankingProfile } from './buyer-ranking-cache.service'
import type { BuyerRankingItem } from './buyer-ranking.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { isBlacklistedBuyer, buildBlacklistedBuyerIds } from './business-metrics.service'
import { isQualityRefundOrder } from './business-metrics.service'
import { centToYuan } from '../utils/money'
import type { AnalyzedOrderView } from '../types/analysis'
import { buildStatRangeMeta } from '../utils/stat-range-label'
import { resolveDateRange } from '../utils/date-range'
import {
  describeMetricsExclusionConfig,
  filterViewsForCoreMetrics,
  isExcludedFromCoreMetrics,
} from './metrics-exclusion.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'

function styleHeader(sheet: ExcelJS.Worksheet, cols: number): void {
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (cols > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } }
  }
}

function addKvSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: Array<[string, string | number]>,
): void {
  const sheet = wb.addWorksheet(name)
  sheet.columns = [{ width: 28 }, { width: 72 }]
  sheet.addRow(['字段', '值'])
  for (const [k, v] of rows) {
    sheet.addRow([k, v])
  }
  styleHeader(sheet, 2)
}

function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: unknown[][],
): void {
  const sheet = wb.addWorksheet(name)
  sheet.addRow(headers)
  for (const r of rows) sheet.addRow(r)
  styleHeader(sheet, headers.length)
}

export async function buildBoardCheckExportBuffer(params: {
  preset: string
  startDate: string
  endDate: string
  username?: string
  pageDisplay?: Record<string, unknown> | null
}): Promise<{ buffer: Buffer; filename: string }> {
  const preset = normalizeBoardPreset(params.preset)
  const rangeMeta = buildStatRangeMeta(params.startDate, params.endDate)
  const rangeResolved = resolveDateRange('custom', params.startDate, params.endDate)
  const { fetchLiveRangeAnalysis } = await import('./board-live-analysis.service')
  const liveAnalysis = await fetchLiveRangeAnalysis({
    startDate: params.startDate,
    endDate: params.endDate,
    requestId: `export-${Date.now()}`,
  })
  const artifacts = prepareAnalysisArtifactsFromRaw(liveAnalysis.bundle)
  const allViews = artifacts?.views ?? liveAnalysis.views
  const rawByMatch = liveAnalysis.rawByMatch
  const viewsWithRaw = attachRawByMatchToViews(allViews, rawByMatch)
  const coreViews = filterViewsForCoreMetrics(viewsWithRaw)
  const unmatched = liveAnalysis.bundle.unmatchedAfterSaleRecords ?? []
  const exclusionMeta = describeMetricsExclusionConfig()
  const live = {
    summary: calculateBusinessMetrics(coreViews) as unknown as Record<string, unknown>,
    requestId: 'export',
  }
  const metrics = calculateBusinessMetrics(coreViews)
  const anchors = aggregateAnchorLeaderboard(coreViews)
  const blacklist = buildBlacklistedBuyerIds(coreViews)
  const buyerProfile = await getBuyerRankingProfile()
  const buyers = buyerProfile?.items ?? []

  const snap = live.summary
  const page = (params.pageDisplay ?? snap) as Record<string, unknown>

  const pageMetrics: Array<[string, number, string]> = [
    ['本期销售额', Number(page.totalGmv ?? page.gmv ?? 0), 'POST /api/board/live-query'],
    ['有效成交额', Number(page.validSalesAmount ?? page.effectiveGmv ?? 0), 'POST /api/board/live-query'],
    ['实际签收金额', Number(page.actualSignedAmount ?? 0), 'POST /api/board/live-query'],
    ['退款金额', Number(page.returnAmount ?? page.productRefundAmount ?? 0), 'POST /api/board/live-query'],
    ['订单数', Number(page.orderCount ?? 0), 'POST /api/board/live-query'],
    ['签收单数', Number(page.signedOrderCount ?? 0), 'POST /api/board/live-query'],
    ['退款单数', Number(page.returnCount ?? 0), 'POST /api/board/live-query'],
    ['商品问题单数', Number(page.qualityReturnCount ?? 0), 'POST /api/board/live-query'],
    ['退款率', Number(page.returnRate ?? 0), 'POST /api/board/live-query'],
    ['品退率', Number(page.qualityReturnRate ?? 0), 'POST /api/board/live-query'],
    ['签收率', Number(page.signRate ?? 0), 'POST /api/board/live-query'],
  ]

  const backendMetrics: Array<[string, number]> = [
    ['totalGmv', metrics.totalGmv],
    ['validSalesAmount', metrics.validSalesAmount],
    ['actualSignedAmount', metrics.actualSignedAmount],
    ['refundAmount', metrics.refundAmount],
    ['orderCount', metrics.orderCount],
    ['signedOrderCount', metrics.signedOrderCount],
    ['refundOrderCount', metrics.refundOrderCount],
    ['qualityRefundOrderCount', metrics.qualityRefundOrderCount],
    ['refundRate', metrics.refundRate ?? 0],
    ['qualityRefundRate', metrics.qualityRefundRate ?? 0],
    ['signRate', metrics.signRate ?? 0],
  ]

  const gmvPage = pageMetrics[0][1]
  const gmvBackend = metrics.totalGmv
  if (Math.abs(gmvPage - gmvBackend) > 0.02) {
    console.warn('BOARD_GMV_MISMATCH', {
      preset: params.preset,
      startDate: params.startDate,
      endDate: params.endDate,
      pageValue: gmvPage,
      recomputedValue: gmvBackend,
      diff: gmvPage - gmvBackend,
      orderCountFromPage: Number(page.orderCount ?? 0),
      orderCountFromRecompute: metrics.orderCount,
      includedOrderIds: coreViews
        .filter((v) => v.includedInGmv)
        .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId),
      excludedOrderIds: coreViews
        .filter((v) => !v.includedInGmv)
        .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId),
    })
  }

  const wb = new ExcelJS.Workbook()
  const now = new Date()
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

  addKvSheet(wb, '核对说明', [
    ['导出时间', now.toISOString()],
    ['当前用户', params.username ?? '—'],
    ['preset', params.preset],
    ['统计开始日期', rangeMeta.startDate],
    ['统计结束日期', rangeMeta.endDate],
    ['统计开始时间', rangeMeta.queryStartTime],
    ['统计结束时间', rangeMeta.queryEndTime],
    ['endTimeMs', rangeResolved.endTimeMs],
    ['是否包含当天实时订单', rangeMeta.includesTodayRealtime ? '是' : '否'],
    ['支付金额统计字段', rangeMeta.payAmountTimeField],
    ['主表订单统计字段', rangeMeta.masterOrderTimeField],
    ['售后统计字段', rangeMeta.afterSaleTimeField],
    ['startDate', params.startDate],
    ['endDate', params.endDate],
    ['数据来源', 'live_api（POST /api/board/live-query）'],
    ['source', 'live_api'],
    ['isFromCache', 'false'],
    ['requestId', live.requestId],
    ['统计函数版本', BUSINESS_METRICS_VERSION],
    ['金额公式版本', AMOUNT_FORMULA_VERSION],
    ['GMV字段', GMV_PAYMENT_FIELD_NOTE],
    ['有效成交额', '各单 effectiveGmvCent 合计'],
    ['实际签收金额', '有效签收订单 actualSignAmountCent 合计（max(支付金额−有效成功退款,0)）'],
    ['退款金额', 'productRefundAmountCent 合计（仅有效成功售后）'],
    ['品退判断', 'strictQualityRefund：最终有效成功售后原因为商品问题'],
    ['签收单数', '有效签收订单数（已签收且签收净额>0）'],
    ['品退率分母', '支付订单数'],
    ['排除直播号', exclusionMeta.excludedLiveAccountNames.join('、') || '—'],
    ['排除店铺', exclusionMeta.excludedShopNames.join('、') || '—'],
    ['排除门店', exclusionMeta.excludedStoreNames.join('、') || '—'],
  ])

  addTableSheet(
    wb,
    '经营总览_页面显示值',
    ['指标', '页面显示', 'rawValue', '数据接口', '备注'],
    pageMetrics.map(([name, val]) => [name, String(val), val, '/api/board/live-query', '']),
  )

  addTableSheet(
    wb,
    '经营总览_后端重算值',
    ['指标', 'rawValue'],
    backendMetrics.map(([k, v]) => [k, v]),
  )

  const diffRows = pageMetrics.map(([name, pageVal], i) => {
    const backendVal = backendMetrics[i]?.[1] ?? 0
    const diff = Number((pageVal - backendVal).toFixed(4))
    const ok = Math.abs(diff) < 0.02 || (name.includes('率') && Math.abs(diff) < 0.0001)
    return [name, pageVal, backendVal, diff, ok ? '是' : '否', ok ? '' : '页面与后端不一致']
  })
  addTableSheet(
    wb,
    '差异对比',
    ['指标', '页面raw', '后端raw', '差异', '一致', '可能原因'],
    diffRows,
  )

  const orderRows = viewsWithRaw.map((v) => {
    const raw = rawByMatch.get(v.matchOrderId || v.orderId)
    const excludedFromCore = isExcludedFromCoreMetrics(v)
    const nick = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>)._buyerNickname ?? v.buyerId) : v.buyerId
    const blocked = isBlacklistedBuyer(v.buyerId, nick, blacklist)
    const anchorTimeRange =
      v.matchedLiveStartTime && v.matchedLiveEndTime
        ? `${v.matchedLiveStartTime} - ${v.matchedLiveEndTime}`
        : v.matchedRuleName ?? ''
    return [
      v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId,
      v.orderTimeText,
      '',
      v.orderStatusText,
      v.afterSaleStatusText,
      v.buyerId,
      nick,
      v.anchorName,
      anchorTimeRange,
      '',
      centToYuan(v.productAmountCent || v.gmvCent),
      centToYuan(v.receivableAmountCent),
      centToYuan(v.actualSellerReceiveAmountCent),
      centToYuan(v.actualPaidCent),
      centToYuan(v.receivableAmountCent),
      centToYuan(v.actualSellerReceiveAmountCent),
      centToYuan(v.gmvCent),
      centToYuan(v.paymentBaseCent),
      v.paymentBaseSource,
      centToYuan(v.effectiveGmvCent),
      centToYuan(v.actualSignAmountCent ?? v.actualSignedAmountCent),
      centToYuan(v.successfulRefundAmountCent ?? v.productRefundAmountCent),
      centToYuan(v.productRefundAmountCent),
      centToYuan(v.freightRefundAmountCent),
      v.includedInGmv ? '是' : '否',
      v.gmvExcludeReason ?? '',
      viewIsCancelled(v) ? '是' : '否',
      viewIsUnpaid(v) ? '是' : '否',
      v.statusSigned ? '是' : '否',
      v.isEffectiveSigned ? '是' : '否',
      v.isReturned ? '是' : '否',
      isQualityRefundOrder(v) ? '是' : '否',
      v.finalAfterSaleReason ?? '',
      v.hasHistoricalQualityReason ? '是' : '否',
      blocked ? '是' : '否',
      excludedFromCore ? '是' : '否',
    ]
  })

  addTableSheet(wb, '订单明细_参与统计', [
    '订单号',
    '下单时间',
    '支付时间',
    '订单状态',
    '售后状态',
    '买家ID',
    '买家昵称',
    'anchorName',
    'anchorTimeRange',
    '商品名称',
    '商品总价',
    '用户应付',
    '商家应收',
    'actualPaid',
    'receivable',
    'sellerReceive',
    'gmvCent',
    'paymentBase',
    'paymentBaseSource',
    'effectiveGmv',
    'actualSignAmount',
    'successfulRefundAmount',
    'productRefund',
    'freightRefund',
    '计入GMV',
    '排除原因',
    '已取消',
    '未支付',
    '状态已签收',
    'isEffectiveSigned',
    '已退款',
    'strictQualityRefund',
    'qualityRefundReason',
    'hasHistoricalQualityReason',
    '黑名单买家',
    '排除核心指标',
  ], orderRows)

  addTableSheet(
    wb,
    '主播本期数据',
    [
      '主播',
      '本期销售额',
      '有效成交额',
      '签收金额',
      '支付订单数',
      '签收单数',
      '退款金额',
      '退款单数',
      '商品问题单数',
      '退款率',
      '品退率',
      '签收率',
      '参与订单号',
    ],
    anchors.map((a) => {
      const ids = coreViews
        .filter((v) => v.anchorName === a.anchorName)
        .map((v) => v.packageId || v.orderId)
        .join(',')
      return [
        a.anchorName,
        a.totalGmv,
        a.validSalesAmount,
        a.actualSignedAmount,
        a.orderCount,
        a.signedCount,
        a.returnAmount,
        a.returnCount,
        a.qualityReturnCount,
        a.returnRate,
        a.qualityReturnRate,
        a.signRate,
        ids,
      ]
    }),
  )

  addTableSheet(
    wb,
    '买家排行',
    [
      '买家ID',
      '买家昵称',
      '下单次数',
      'GMV',
      '签收金额',
      '退款金额',
      '退款次数',
      '品退次数',
      '黑名单',
      '标签',
      '建议',
      '订单号列表',
    ],
    buyers.map((b: BuyerRankingItem) => {
      const tags = b.customerTags?.length ? b.customerTags.join(',') : ''
      return [
        b.buyerId,
        b.nickname,
        b.orderCount,
        b.gmv,
        b.signedAmount,
        b.productRefundAmount,
        b.refundTimes,
        b.qualityReturnCount,
        b.isBlacklisted ? '是' : '否',
        tags,
        b.suggestion,
        '',
      ]
    }),
  )

  const abnormal: unknown[][] = []
  const abnormalOrderNos = artifacts?.abnormalOrderNos ?? []
  if (abnormalOrderNos.length > 0) {
    for (const orderNo of abnormalOrderNos) {
      abnormal.push([orderNo, '时间异常', '下单/支付/完成时间无效', '', '', '', '未计入本期统计'])
    }
  }
  for (const v of viewsWithRaw) {
    if (!v.includedInGmv && v.gmvExcludeReason) {
      abnormal.push([
        v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId,
        'GMV排除',
        v.gmvExcludeReason,
        v.orderStatusText,
        v.afterSaleStatusText,
        `paymentBase=${centToYuan(v.paymentBaseCent)}`,
        '未计入GMV',
      ])
    }
    if (v.anchorName === '未归属' || !v.anchorName) {
      abnormal.push([
        v.displayOrderNo || v.officialOrderNo || v.packageId || v.orderId,
        '未归属主播',
        v.attributionType,
        v.orderStatusText,
        '',
        '',
        v.anchorName,
      ])
    }
  }
  addTableSheet(wb, '异常订单', ['订单号', '异常类型', '异常原因', '订单状态', '售后状态', '金额', '处理结果'], abnormal)

  addTableSheet(
    wb,
    'unmatchedAfterSaleRecords',
    [
      'package_id',
      'delivery_package_id',
      'returns_id',
      'refund_fee',
      'settlement_amount',
      'pay_amount',
      'status_name',
      'refund_status_name',
      'reason_name_zh',
      'return_type_name',
      'time',
      'unmatchedReason',
      'explanation',
    ],
    unmatched.map((u) => [
      u.package_id,
      u.delivery_package_id,
      u.returns_id,
      centToYuan(u.refund_fee_cent),
      centToYuan(u.settlement_amount_cent),
      centToYuan(u.pay_amount_cent),
      u.status_name,
      u.refund_status_name,
      u.reason_name_zh,
      u.return_type_name,
      u.time,
      u.unmatchedReason,
      u.explanation,
    ]),
  )

  const buf = await wb.xlsx.writeBuffer()
  return {
    buffer: Buffer.from(buf),
    filename: `经营看板数据核对_${ts}.xlsx`,
  }
}

function viewIsCancelled(v: AnalyzedOrderView): boolean {
  const text = v.orderStatusText ?? ''
  return ['已取消', '取消', '交易关闭'].some((k) => text.includes(k))
}

function viewIsUnpaid(v: AnalyzedOrderView): boolean {
  return (v.gmvExcludeReason ?? '').includes('未支付')
}
