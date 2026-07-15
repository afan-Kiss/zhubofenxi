import React, { forwardRef, useMemo } from 'react'
import { formatAnchorDisplayName } from '../../lib/anchor-display-name'
import { isOfflineOnlyAnchor } from '../../lib/anchor-system-keys'
import type { DailyOperationsReportPayload } from '../../pages/operations/operationsReportTypes'
import {
  formatDuration,
  formatHourly,
  formatIntegerMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
} from './operationsReportFormatters'

interface Props {
  data: DailyOperationsReportPayload
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function anchorHasLive(row: DailyOperationsReportPayload['anchors'][number]): boolean {
  const liveTime = row.liveTimeRange?.trim()
  if (liveTime && liveTime !== '—') return true
  const period = row.livePeriodText?.trim()
  return Boolean(period && period !== '—' && !period.includes('未读取'))
}

function anchorStatusLine(row: DailyOperationsReportPayload['anchors'][number]): string {
  const hasLive = anchorHasLive(row)
  const hasSales = row.validAmountYuan > 0 || row.soldOrderCount > 0 || row.paidOrderCount > 0
  if (hasLive && !hasSales) return '有直播，无成交'
  if (!hasLive && !hasSales) return '当日无直播或无成交'
  return ''
}

export const OperationsReportImageSheet = forwardRef<HTMLDivElement, Props>(({ data }, ref) => {
  const hotItems = (data.rankings?.products.hot.items ?? []).slice(0, 5)
  const highReturnItems = (data.rankings?.products.highReturn.items ?? []).slice(0, 5)
  const insightItems = (data.businessInsights?.items ?? []).slice(0, 6)
  const qualityWarnings = data.reportDataQuality?.warnings ?? []
  const visibleAnchors = useMemo(
    () => (data.anchors ?? []).filter((row) => !isOfflineOnlyAnchor({ systemKey: row.systemKey })),
    [data.anchors],
  )

  return (
    <div ref={ref} className="w-[720px] bg-white p-6 text-slate-900">
      <h1 className="text-xl font-bold">{data.title}</h1>
      <p className="mt-1 text-sm text-slate-500">
        本日报统计线上直播经营数据，线下成交请在主播业绩页的「线下 GMV」中查看。
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MetricCard label="全店有效成交" value={formatIntegerMoney(data.summary.validAmountYuan)} />
        <MetricCard label="有效成交订单" value={formatOrderCount(data.summary.soldOrderCount)} />
        <MetricCard label="全店无效/刷单" value={formatOrderCount(data.summary.invalidOrderCount)} />
        <MetricCard label="退货单率" value={formatRatePercent(data.summary.returnOrderRate)} />
        <MetricCard label="成交人数" value={formatPeopleCount(data.summary.dealUserCount)} />
        <MetricCard label="成交率" value={formatRatePercent(data.summary.dealConversionRate)} />
        <MetricCard label="客单价" value={formatIntegerMoney(data.summary.avgOrderAmountYuan)} />
        <MetricCard
          label="直播时长"
          value={formatDuration(data.summary.totalLiveDurationMinutes)}
        />
        <MetricCard label="每小时成交" value={formatHourly(data.summary.hourlyAmountYuan)} />
        <MetricCard
          label="新增粉丝"
          value={formatPeopleCount(data.summary.totalNewFollowerCount)}
        />
      </div>

      {data.summary.liveRoomNewFollowers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-700">各直播号新增粉丝</p>
          <div className="mt-2 space-y-1 text-xs text-slate-600">
            {data.summary.liveRoomNewFollowers.map((row) => (
              <p key={row.liveAccountName}>
                {row.liveAccountName}：{formatPeopleCount(row.newFollowerCount)}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="mb-2 text-sm font-semibold">主播表现</p>
        {visibleAnchors.map((row) => {
          const liveTime =
            row.liveTimeRange && row.liveTimeRange !== '—'
              ? row.liveTimeRange
              : row.livePeriodText?.replace(/~/g, '–') ?? '—'
          const attributionRange =
            row.scheduleTimeRange && row.scheduleTimeRange !== '—'
              ? row.scheduleTimeRange.replace(/~/g, '–')
              : '—'
          const statusLine = anchorStatusLine(row)
          const paidCount = row.paidOrderCount ?? 0
          return (
            <div
              key={`${row.anchorName}-${row.systemKey ?? row.anchorId ?? ''}`}
              className="mb-2 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed"
            >
              <p className="text-sm font-semibold">
                {formatAnchorDisplayName(row.anchorName)} · {row.sessionLabel || row.shopName}
              </p>
              <p className="mt-1 text-slate-600">
                实际直播 {liveTime} · 归属时段 {attributionRange}
              </p>
              <p className="mt-1 text-slate-700">
                已签收金额 {formatIntegerMoney(row.validAmountYuan)} · 支付单数{' '}
                {formatOrderCount(paidCount)} · 已签收订单 {formatOrderCount(row.soldOrderCount)}
                {' · '}
                退货单 {formatOrderCount(row.returnOrderCount)}（
                {formatRatePercent(row.returnOrderRate)}）
              </p>
              {statusLine ? (
                <p className="mt-1 text-amber-700">{statusLine}</p>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-700">热卖商品前 5</p>
          {hotItems.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">暂无数据</p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs text-slate-700">
              {hotItems.map((item, index) => (
                <li key={item.productKey}>
                  {index + 1}. {item.productName}
                  <span className="text-slate-500">
                    {' '}
                    · 内部有效成交口径 {formatIntegerMoney(item.validAmountYuan)} ·{' '}
                    {formatOrderCount(item.soldOrderCount)} 单
                    {item.sampleTooSmall ? ' · 样本少，仅参考' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-700">高退货商品前 5</p>
          {highReturnItems.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">暂无数据</p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs text-slate-700">
              {highReturnItems.map((item, index) => (
                <li key={item.productKey}>
                  {index + 1}. {item.productName}
                  <span className="text-slate-500">
                    {' '}
                    · 退货 {formatOrderCount(item.returnOrderCount)} 单（
                    {formatRatePercent(item.returnRate)}）
                    {item.sampleTooSmall ? ' · 样本少，仅参考' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
        <p className="text-xs font-semibold text-emerald-900">经营建议</p>
        {insightItems.length === 0 ? (
          <p className="mt-2 text-xs text-slate-600">今日暂无额外建议，可对照上方数据复盘。</p>
        ) : (
          <ul className="mt-2 space-y-2 text-xs text-slate-700">
            {insightItems.map((item) => (
              <li key={item.id}>
                <span className="font-medium text-slate-800">{item.title}</span>
                <span className="text-slate-600"> — {item.suggestedAction || item.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {qualityWarnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">有部分数据需人工核对</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            {qualityWarnings.slice(0, 5).map((warning) => (
              <li key={warning}>· {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-500">
        <p>有效成交 = 已完成/已签收订单金额，与经营总览同源口径。</p>
        <p className="mt-1">
          商品榜金额标注为「内部有效成交口径」，仅用于运营复盘，与全店有效成交不同。
        </p>
        <p className="mt-1">每小时成交 = 全店有效成交 ÷ 全部直播时长。</p>
      </div>
    </div>
  )
})

OperationsReportImageSheet.displayName = 'OperationsReportImageSheet'
