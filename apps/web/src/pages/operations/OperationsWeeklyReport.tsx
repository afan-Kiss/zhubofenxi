import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { AnchorOperationsTable } from '../../components/operations/AnchorOperationsTable'
import { ProductPerformanceTable } from '../../components/operations/ProductPerformanceTable'
import { PriceBandTable } from '../../components/operations/PriceBandTable'
import { AfterSalesReasonTable } from '../../components/operations/AfterSalesReasonTable'
import { OperationsReviewEditor } from '../../components/operations/OperationsReviewEditor'
import {
  formatIntegerMoney,
  formatOrderCount,
  formatPercent,
} from '../../components/operations/operationsReportFormatters'
import type {
  OpsReviewNotePayload,
  WeeklyOperationsReportPayload,
} from './operationsReportTypes'

interface Props {
  weekStart: string
  weekEnd: string
}

function highlightToProductRow(
  p: WeeklyOperationsReportPayload['hotProducts'][number],
  role: string,
): import('./operationsReportTypes').OperationsProductRow {
  return {
    productKey: p.productKey,
    itemId: '',
    productName: p.productName,
    skuName: p.skuName,
    shopName: p.shopName,
    productCode: p.productCode,
    ringSize: p.ringSize,
    barType: p.barType,
    soldCount: p.soldCount,
    soldOrderCount: p.soldOrderCount,
    soldAmountYuan: p.validAmountYuan ?? p.soldAmountYuan,
    buyerCount: p.buyerCount,
    returnOrderCount: p.returnOrderCount,
    returnRate: p.returnRate,
    productRole: role,
    productRoleLabel: p.rankReason || p.productRoleLabel,
  }
}

export const OperationsWeeklyReport: React.FC<Props> = ({ weekStart, weekEnd }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<WeeklyOperationsReportPayload | null>(null)

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ weekStart, weekEnd, preset: 'custom' })
      const data = await apiRequest<WeeklyOperationsReportPayload>(
        `/api/board/operations-report/weekly?${qs}`,
      )
      setReport(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载运营周报失败')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [weekStart, weekEnd])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const handleReviewSaved = (note: OpsReviewNotePayload) => {
    setReport((prev) => (prev ? { ...prev, reviewNote: note } : prev))
  }

  if (loading && !report) {
    return <p className="text-sm text-slate-500">加载运营周报...</p>
  }

  if (error && !report) {
    return (
      <div>
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => void loadReport()}
          className="mt-2 rounded-full border border-slate-200 px-3 py-1 text-sm"
        >
          重试
        </button>
      </div>
    )
  }

  if (!report) return null

  const s = report.summary
  const anchorRows = report.anchors.map((row) => ({
    anchorName: row.anchorName,
    sessionLabel: '周汇总',
    shopName: '',
    livePeriodText: '—',
    liveDurationText: `${Math.round(row.liveDurationMinutes)}分钟`,
    liveDurationMinutes: row.liveDurationMinutes,
    validAmountYuan: row.validAmountYuan,
    soldOrderCount: row.soldOrderCount,
    invalidOrderCount: 0,
    returnOrderCount: row.returnOrderCount,
    returnOrderRate: row.returnOrderRate,
    avgOrderAmountYuan:
      row.soldOrderCount > 0 ? Math.round(row.validAmountYuan / row.soldOrderCount) : null,
    hourlyAmountYuan: null,
    amountRatio: null,
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: row.dealUserCount,
    dealConversionRate: null,
    newFollowerRate: null,
  }))

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">本周有效成交</p>
          <p className="mt-1 text-base font-semibold">{formatIntegerMoney(s.validAmountYuan)}</p>
          {s.validAmountChangePercent != null ? (
            <p className="mt-1 text-xs text-slate-500">
              较上周 {s.validAmountChangePercent >= 0 ? '+' : ''}
              {s.validAmountChangePercent}%
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">本周订单</p>
          <p className="mt-1 text-base font-semibold">{formatOrderCount(s.soldOrderCount)}</p>
          {s.soldOrderChangePercent != null ? (
            <p className="mt-1 text-xs text-slate-500">
              较上周 {s.soldOrderChangePercent >= 0 ? '+' : ''}
              {s.soldOrderChangePercent}%
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">退货单率</p>
          <p className="mt-1 text-base font-semibold">{formatPercent(s.returnOrderRate)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">新增粉丝</p>
          <p className="mt-1 text-base font-semibold">{s.totalNewFollowerCount}人</p>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">每日趋势</h3>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-[640px] w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2">有效成交</th>
                <th className="px-3 py-2">订单</th>
                <th className="px-3 py-2">退货单</th>
              </tr>
            </thead>
            <tbody>
              {report.dailyTrend.map((row) => (
                <tr key={row.dateKey} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.dateLabel}</td>
                  <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
                  <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
                  <td className="px-3 py-2">{formatOrderCount(row.returnOrderCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">主播周表现对比</h3>
        <AnchorOperationsTable rows={anchorRows} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">热卖前 10</h3>
          <p className="mb-2 text-xs text-slate-500">按有效成交金额、成交订单、成交件数排序</p>
          <ProductPerformanceTable
            rows={report.hotProducts.map((p) => highlightToProductRow(p, 'hot_sale'))}
          />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">
            {report.productRankingQuality?.slowReliable
              ? '主推未成交/低成交商品'
              : '滞销观察'}
          </h3>
          {report.productRankingQuality?.slowReliable ? (
            <p className="mb-2 text-xs text-slate-500">基于人工主推候选池，本周未成交或低成交</p>
          ) : (
            <p className="mb-2 text-xs text-amber-700">
              {report.productRankingQuality?.warnings?.find((w) => w.includes('滞销') || w.includes('数据不足')) ??
                '数据不足，暂无法可靠判断滞销'}
            </p>
          )}
          {report.productRankingQuality?.slowReliable ? (
            <ProductPerformanceTable
              rows={report.slowProducts.map((p) => highlightToProductRow(p, 'slow_moving'))}
            />
          ) : null}
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">高退货风险前 5</h3>
          <p className="mb-2 text-xs text-slate-500">按商品退货订单率排序（成交≥3单）</p>
          <ProductPerformanceTable
            rows={report.highReturnProducts.map((p) => highlightToProductRow(p, 'high_return_risk'))}
          />
          {report.highReturnSampleTooSmall?.length ? (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-amber-700">样本不足，仅参考</p>
              <ProductPerformanceTable
                rows={report.highReturnSampleTooSmall.map((p) =>
                  highlightToProductRow(p, 'high_return_risk'),
                )}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">价格带分析</h3>
        <PriceBandTable rows={report.priceBands} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">售后原因</h3>
        <AfterSalesReasonTable rows={report.afterSalesReasons} />
      </section>

      <OperationsReviewEditor
        reportDate={weekStart}
        reportType="weekly"
        initialNote={report.reviewNote}
        onSaved={handleReviewSaved}
      />
    </div>
  )
}
