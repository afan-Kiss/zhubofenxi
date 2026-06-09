import ExcelJS from 'exceljs'
import type { BoardLiveQueryResult } from './board-live-query.service'
import { getBuyerRankingProfile } from './buyer-ranking-cache.service'
import type { BuyerRankingItem } from './buyer-ranking.service'
import { formatBuyerIdentityCode, formatDisplayBuyerId } from './buyer-identity.service'
import { formatCount, formatRate, formatYuan } from '../utils/money'

function styleHeader(sheet: ExcelJS.Worksheet, cols: number): void {
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (cols > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } }
  }
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

function formatTs(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
}

function num(v: unknown): number {
  return Number(v ?? 0)
}

function s(v: unknown): string {
  if (v == null || v === '') return '—'
  return String(v)
}

function yesNo(v: unknown): string {
  return v === true || v === 'true' || v === 1 ? '是' : '否'
}

export function assertLiveQueryExportPayload(
  data: unknown,
): asserts data is BoardLiveQueryResult {
  if (!data || typeof data !== 'object') {
    throw new Error('缺少实时查询数据，请先在经营看板完成数据刷新')
  }
  const d = data as BoardLiveQueryResult
  if (d.source !== 'live_api' || d.isFromCache !== false) {
    throw new Error('仅支持导出实时接口数据，请先刷新经营看板')
  }
  if (!d.summary || !Array.isArray(d.allOrders)) {
    throw new Error('实时数据不完整，请重新刷新后再导出')
  }
}

export async function buildBoardReconciliationExportBuffer(
  live: BoardLiveQueryResult,
): Promise<{ buffer: Buffer; filename: string }> {
  assertLiveQueryExportPayload(live)

  const summary = live.summary
  const blacklist = new Set(live.blacklistedBuyerIds ?? [])
  const buyerProfile = await getBuyerRankingProfile()
  const wb = new ExcelJS.Workbook()
  const now = new Date()

  addTableSheet(wb, '经营总览', ['指标', '数值'], [
    ['支付金额', formatYuan(num(summary.totalGmv ?? summary.gmv))],
    ['有效销售额', formatYuan(num(summary.validSalesAmount ?? summary.effectiveGmv))],
    ['实际签收金额', formatYuan(num(summary.actualSignedAmount))],
    ['退款金额', formatYuan(num(summary.returnAmount ?? summary.productRefundAmount))],
    ['支付订单数', formatCount(num(summary.orderCount))],
    ['签收单数', formatCount(num(summary.signedOrderCount ?? summary.actualSignedCount))],
    ['涉及退款/售后订单数', formatCount(num(summary.returnCount))],
    ['品退单数', formatCount(num(summary.qualityReturnCount))],
    ['退款率', formatRate(num(summary.returnRate))],
    ['品退率', formatRate(num(summary.qualityReturnRate))],
    ['签收率', formatRate(num(summary.signRate))],
    ['数据范围', `${live.startDate} ~ ${live.endDate}`],
    ['requestId', live.requestId],
    ['fetchedAt', live.fetchedAt],
  ])

  addTableSheet(
    wb,
    '主播贡献排行',
    [
      '主播',
      '支付金额',
      '有效销售额',
      '签收金额',
      '支付订单数',
      '退款金额',
      '退款/售后单数',
      '品退单数',
      '退款率',
      '品退率',
      '签收率',
    ],
    (live.anchorLeaderboard ?? []).map((a) => [
      s(a.anchorName),
      formatYuan(num(a.gmv ?? a.totalGmv)),
      formatYuan(num(a.validSalesAmount ?? a.effectiveGmv)),
      formatYuan(num(a.actualSignedAmount)),
      formatCount(num(a.orderCount)),
      formatYuan(num(a.returnAmount ?? a.productRefundAmount)),
      formatCount(num(a.returnCount)),
      formatCount(num(a.qualityReturnCount)),
      formatRate(num(a.returnRate)),
      formatRate(num(a.qualityReturnRate)),
      formatRate(num(a.signRate)),
    ]),
  )

  addTableSheet(
    wb,
    '买家排行',
    [
      'buyerKey',
      '买家识别码',
      '买家昵称',
      '下单次数',
      '支付金额',
      '签收金额',
      '退款金额',
      '退款次数',
      '品退次数',
      '是否黑名单',
      '客户标签',
    ],
    (buyerProfile?.items ?? []).map((b: BuyerRankingItem) => {
      const tags = b.customerTags?.length ? b.customerTags.join('、') : s(b.customerTag)
      return [
        s(b.buyerKey),
        s(b.buyerIdentityCode ?? formatBuyerIdentityCode(b.buyerKey, b.buyerId)),
        s(b.nickname),
        formatCount(num(b.orderCount)),
        formatYuan(num(b.statPaidAmount ?? b.gmv)),
        formatYuan(num(b.signedAmount)),
        formatYuan(num(b.productRefundAmount)),
        formatCount(num(b.refundTimes)),
        formatCount(num(b.qualityReturnCount)),
        b.isBlacklisted ? '是' : '否',
        tags,
      ]
    }),
  )

  addTableSheet(
    wb,
    '订单明细',
    [
      '订单号',
      '下单时间',
      '主播',
      '买家昵称',
      '买家ID',
      '商品名称',
      '商家应收/支付金额',
      '退款金额',
      '订单状态',
      '售后状态',
      '售后原因',
      '是否计入支付金额',
      '排除原因',
      '是否品退',
      '是否黑名单买家',
    ],
    (live.allOrders ?? []).map((o) => {
      const r = o as Record<string, unknown>
      const bid = formatDisplayBuyerId(String(r.buyerId ?? ''))
      const nick = s(r.buyerNickname)
      const buyerKey = String(r.buyerKey ?? r.buyerId ?? '')
      const blocked =
        Boolean(r.isBlacklistedBuyer) ||
        (buyerKey ? blacklist.has(buyerKey) : false)
      const payBase = num(r.paymentBaseAmount ?? r.payAmount)
      const merchant = num(r.merchantReceivableAmount ?? 0)
      const amount = payBase > 0 ? payBase : merchant
      return [
        s(r.displayOrderNo ?? r.officialOrderNo ?? r.orderNo ?? r.packageId),
        s(r.orderTime),
        s(r.anchorName),
        nick,
        bid,
        s(r.productName),
        formatYuan(amount),
        formatYuan(num(r.refundAmount ?? r.productRefundAmount)),
        s(r.orderStatus),
        s(r.afterSaleStatus ?? r.afterSaleDisplayType),
        s(r.afterSaleReason),
        yesNo(r.includedInGmv),
        s(r.gmvExcludeReason ?? r.excludeReason),
        yesNo(r.isQualityReturn),
        blocked ? '是' : '否',
      ]
    }),
  )

  const buf = await wb.xlsx.writeBuffer()
  return {
    buffer: Buffer.from(buf),
    filename: `经营看板核对表_${formatTs(now)}.xlsx`,
  }
}
