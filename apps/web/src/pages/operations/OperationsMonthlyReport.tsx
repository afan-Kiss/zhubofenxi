import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { AnchorRankingTable } from '../../components/operations/AnchorRankingTable'
import { ProductRankingTable } from '../../components/operations/ProductRankingTable'
import { PriceBandRankingTable } from '../../components/operations/PriceBandRankingTable'
import { AfterSalesRankingTable } from '../../components/operations/AfterSalesRankingTable'
import { BusinessInsightCards } from '../../components/operations/BusinessInsightCards'
import { BusinessInsightActionStatsCard } from '../../components/operations/BusinessInsightActionStatsCard'
import { RankingSection } from '../../components/operations/RankingMetricTooltip'
import { RankingQualityBadge } from '../../components/operations/RankingQualityBadge'
import { PLAIN, formatChangePercent, humanizeWarning } from '../../components/operations/operationPlainText'
import {
  formatHourly,
  formatIntegerMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
} from '../../components/operations/operationsReportFormatters'
import type { MonthlyOperationsReportPayload, WithOperationsReportCacheMeta } from './operationsReportTypes'
import { OperationsReportCacheHint } from '../../components/operations/OperationsReportCacheHint'
import { OperationsMetricDrillCard } from '../../components/operations/OperationsMetricDrillCard'
import {
  anchorDrillTarget,
  priceBandDrillTarget,
  productDrillTarget,
} from '../../components/operations/operationsBiDrillHelpers'
import type { OperationsBiDrillContextProps, OperationsBiDrillRequest } from './operationsBiDrillTypes'

interface Props {
  month: string
}

const LEVEL_CLASS = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  bad: 'border-rose-200 bg-rose-50 text-rose-900',
  info: 'border-slate-200 bg-white text-slate-800',
} as const

export const OperationsMonthlyReport: React.FC<Props> = ({ month }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<MonthlyOperationsReportPayload | null>(null)
  const [cacheMeta, setCacheMeta] = useState<
    WithOperationsReportCacheMeta<MonthlyOperationsReportPayload>['cacheMeta']
  >(undefined)
  const [cacheWarning, setCacheWarning] = useState<string | null>(null)

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ month, preset: 'custom' })
      const data = await apiRequest<WithOperationsReportCacheMeta<MonthlyOperationsReportPayload>>(
        `/api/board/operations-monthly-report?${qs}`,
      )
      const { cacheMeta: meta, cacheWarning: warning, ...payload } = data
      setReport(payload)
      setCacheMeta(meta)
      setCacheWarning(warning ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载运营月报失败')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  if (loading && !report) {
    return <p className="text-sm text-slate-500">加载运营月报…</p>
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
  const cmp = report.compareWithPreviousMonth
  const drillBase: Omit<OperationsBiDrillRequest, 'target'> = {
    source: 'monthly_summary',
    startDate: report.range.startDate,
    endDate: report.range.endDate,
    scope: 'monthly',
  }
  const rankingDrillContext: OperationsBiDrillContextProps = {
    source: 'monthly_summary',
    startDate: report.range.startDate,
    endDate: report.range.endDate,
    scope: 'monthly',
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{report.title}</h2>
        <OperationsReportCacheHint cacheMeta={cacheMeta} cacheWarning={cacheWarning} className="mt-1" />
        <p className="mt-1 text-xs text-slate-500">
          {report.range.startDate} ~ {report.range.endDate}
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">本月总览</h3>
        <p className="text-xs text-slate-500">{PLAIN.monthlyOverviewHint}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <OperationsMetricDrillCard
            label={PLAIN.validAmount}
            value={formatIntegerMoney(s.validAmountYuan)}
            drillRequest={{ ...drillBase, target: 'summary_valid_amount' }}
          />
          <OperationsMetricDrillCard
            label={PLAIN.soldOrders}
            value={formatOrderCount(s.soldOrderCount)}
            drillRequest={{ ...drillBase, target: 'summary_orders' }}
          />
          <MetricCard label={PLAIN.soldCount} value={String(s.soldCount)} />
          <MetricCard label="客单价" value={formatIntegerMoney(s.averageOrderValue)} />
          <OperationsMetricDrillCard
            label={PLAIN.productReturnRate}
            value={formatRatePercent(s.productReturnRate)}
            drillRequest={{ ...drillBase, target: 'summary_return_rate' }}
          />
          <MetricCard
            label="直播时长"
            value={s.liveDurationHours != null ? `${s.liveDurationHours.toFixed(1)} 小时` : '--'}
          />
          <OperationsMetricDrillCard
            label="每小时成交"
            value={formatHourly(s.hourlyAmountYuan)}
            drillRequest={{ ...drillBase, target: 'summary_valid_amount' }}
          />
          <MetricCard label="场观" value={formatPeopleCount(s.viewSessionCount)} />
          <MetricCard label="进房" value={formatPeopleCount(s.joinUserCount)} />
          <OperationsMetricDrillCard
            label="成交人数"
            value={formatPeopleCount(s.dealUserCount)}
            drillRequest={{ ...drillBase, target: 'summary_buyer_count' }}
          />
          <OperationsMetricDrillCard
            label={PLAIN.dealRate}
            value={
              s.dealConversionRate != null
                ? formatRatePercent(s.dealConversionRate)
                : PLAIN.dealRateMissing
            }
            drillRequest={{ ...drillBase, target: 'summary_deal_conversion' }}
          />
          <MetricCard label="新增粉丝" value={formatPeopleCount(s.newFollowerCount)} />
          <MetricCard label={PLAIN.followerRate} value={formatRatePercent(s.followerConversionRate)} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">跟上月对比</h3>
        <p className="text-xs text-slate-500">{PLAIN.compareHint}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label={`${PLAIN.validAmount}${PLAIN.comparePrev}`}
            value={formatChangePercent(cmp.validAmountYuanChangePercent)}
          />
          <MetricCard
            label={`${PLAIN.soldOrders}${PLAIN.comparePrev}`}
            value={formatChangePercent(cmp.soldOrderCountChangePercent)}
          />
          <MetricCard
            label={`${PLAIN.productReturnRate}${PLAIN.comparePrev}`}
            value={formatChangePercent(cmp.productReturnRateChangePercent)}
          />
          <MetricCard
            label={`${PLAIN.dealRate}${PLAIN.comparePrev}`}
            value={formatChangePercent(cmp.dealConversionRateChangePercent)}
          />
          <MetricCard
            label={`新增粉丝${PLAIN.comparePrev}`}
            value={formatChangePercent(cmp.newFollowerCountChangePercent)}
          />
        </div>
        {cmp.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700">
            {humanizeWarning(w)}
          </p>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">{report.plainLanguageSummary.title}</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {report.plainLanguageSummary.items.map((item) => (
            <div
              key={item.label}
              className={`rounded-2xl border p-3 text-xs ${LEVEL_CLASS[item.level]}`}
            >
              <p className="font-medium">{item.label}</p>
              <p className="mt-1 leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">每日趋势</h3>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-[720px] w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">日期</th>
                <th className="px-3 py-2">{PLAIN.validAmount}</th>
                <th className="px-3 py-2">{PLAIN.soldOrders}</th>
                <th className="px-3 py-2">商品退货单</th>
                <th className="px-3 py-2">{PLAIN.productReturnRate}</th>
              </tr>
            </thead>
            <tbody>
              {report.dailyTrend.map((row) => (
                <tr key={row.date} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.date}</td>
                  <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
                  <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
                  <td className="px-3 py-2">{formatOrderCount(row.productReturnOrderCount)}</td>
                  <td className="px-3 py-2">{formatRatePercent(row.productReturnRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">主播月度表现</h3>
        <p className="text-xs text-slate-500">{PLAIN.anchorAmountHint}</p>
        {(
          [
            report.rankings.anchors.byAmount,
            report.rankings.anchors.byOrders,
            report.rankings.anchors.byHourlyAmount,
            report.rankings.anchors.byDealConversion,
            report.rankings.anchors.byReturnRate,
          ] as const
        ).map((list) => (
          <RankingSection
            key={list.rankingType}
            title={list.title}
            subtitle={list.subtitle}
            dataQuality={list.dataQuality}
            sampleTooSmall={
              list.sampleTooSmall?.length ? (
                <AnchorRankingTable
                  rows={list.sampleTooSmall}
                  drillContext={rankingDrillContext}
                  drillTarget={anchorDrillTarget(list.rankingType)}
                />
              ) : undefined
            }
          >
            <AnchorRankingTable
              rows={list.items}
              drillContext={rankingDrillContext}
              drillTarget={anchorDrillTarget(list.rankingType)}
            />
          </RankingSection>
        ))}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">商品月度表现</h3>
        <p className="text-xs text-slate-500">{PLAIN.hotProductHint}</p>
        {(
          [
            report.rankings.products.hot,
            report.rankings.products.highReturn,
            report.rankings.products.slow,
            report.rankings.products.highAverageOrderValue,
          ] as const
        ).map((list) => (
          <RankingSection
            key={list.rankingType}
            title={list.title}
            subtitle={list.subtitle}
            dataQuality={list.dataQuality}
            sampleTooSmall={
              list.sampleTooSmall?.length ? (
                <ProductRankingTable
                  rows={list.sampleTooSmall}
                  drillContext={rankingDrillContext}
                  drillTarget={productDrillTarget(list.rankingType)}
                />
              ) : undefined
            }
          >
            <ProductRankingTable
              rows={list.items}
              drillContext={rankingDrillContext}
              drillTarget={productDrillTarget(list.rankingType)}
            />
          </RankingSection>
        ))}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">价格带月度表现</h3>
        <p className="text-xs text-slate-500">{PLAIN.priceBandHint}</p>
        {(
          [
            report.rankings.priceBands.byAmount,
            report.rankings.priceBands.byShare,
            report.rankings.priceBands.byReturnRate,
          ] as const
        ).map((list) => (
          <RankingSection
            key={list.rankingType}
            title={list.title}
            subtitle={list.subtitle}
            dataQuality={list.dataQuality}
          >
            <PriceBandRankingTable
              rows={list.items}
              drillContext={rankingDrillContext}
              drillTarget={priceBandDrillTarget(list.rankingType)}
            />
          </RankingSection>
        ))}
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">售后与退货问题</h3>
        <p className="text-xs text-slate-500">{PLAIN.afterSalesHint}</p>
        <RankingSection
          title={report.rankings.afterSales.byReason.title}
          subtitle={report.rankings.afterSales.byReason.subtitle}
          dataQuality={report.rankings.afterSales.byReason.dataQuality}
        >
          <AfterSalesRankingTable
            rows={report.rankings.afterSales.byReason.items}
            drillContext={rankingDrillContext}
            drillTarget="after_sales_reason"
          />
        </RankingSection>
        <RankingSection
          title={report.rankings.afterSales.byRefundAmount.title}
          subtitle={report.rankings.afterSales.byRefundAmount.subtitle}
          dataQuality={report.rankings.afterSales.byRefundAmount.dataQuality}
        >
          <AfterSalesRankingTable
            rows={report.rankings.afterSales.byRefundAmount.items}
            drillContext={rankingDrillContext}
            drillTarget="after_sales_refund_amount"
          />
        </RankingSection>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">{PLAIN.businessInsights}</h3>
        <BusinessInsightCards
          insights={report.businessInsights}
          rangeStartDate={report.range.startDate}
          rangeEndDate={report.range.endDate}
          scope="custom"
          onRefresh={loadReport}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">建议处理情况</h3>
        <p className="mb-2 text-xs text-slate-500">{PLAIN.insightStatsNote}</p>
        <BusinessInsightActionStatsCard
          rangeStartDate={report.range.startDate}
          rangeEndDate={report.range.endDate}
          scope="custom"
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">风险提醒</h3>
        <p className="text-xs text-slate-500">{PLAIN.riskIntro}</p>
        <ul className="space-y-2">
          {report.riskReminders.map((r, i) => (
            <li
              key={`${r.text}-${i}`}
              className={`rounded-xl border px-3 py-2 text-xs ${
                r.level === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              {humanizeWarning(r.text)}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">下月重点动作</h3>
        {report.nextMonthActions.length === 0 ? (
          <p className="text-sm text-slate-500">{PLAIN.noNextMonthActions}</p>
        ) : (
          <ul className="space-y-3">
            {report.nextMonthActions.map((action, i) => (
              <li key={`${action.text}-${i}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                <p className="text-sm text-slate-800">{action.text}</p>
                <div className="mt-2 space-y-0.5">
                  <p className="text-xs font-medium text-slate-500">{PLAIN.basis}</p>
                  {action.evidence.map((ev) => (
                    <p key={`${ev.label}-${String(ev.value)}`} className="text-xs text-slate-600">
                      {ev.label}：{ev.value == null ? '--' : String(ev.value)}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">{PLAIN.dataQualityTitle}</h3>
        <RankingQualityBadge
          reliable={report.dataQuality.reliable}
          confidence={report.dataQuality.reliable ? 'high' : 'insufficient'}
          warnings={report.dataQuality.warnings.map(humanizeWarning)}
        />
      </section>
    </div>
  )
}

const MetricCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-3">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
  </div>
)
