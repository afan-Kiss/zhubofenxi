import React from 'react'

/** 与后端 DailyReportShopScoreItem 对齐 */
export interface DailyReportShopScoreItem {
  shopKey: string
  shopName: string
  scoreDate: string | null
  previousScoreDate: string | null
  overallScore: number | null
  overallDelta: number | null
  qualityScore: number | null
  logisticsScore: number | null
  serviceScore: number | null
  qualityDelta: number | null
  logisticsDelta: number | null
  serviceDelta: number | null
  available: boolean
}

const SUB_ITEMS: Array<{
  label: string
  scoreKey: 'qualityScore' | 'logisticsScore' | 'serviceScore'
  deltaKey: 'qualityDelta' | 'logisticsDelta' | 'serviceDelta'
  accent: string
}> = [
  { label: '品质', scoreKey: 'qualityScore', deltaKey: 'qualityDelta', accent: '#be123c' },
  { label: '物流', scoreKey: 'logisticsScore', deltaKey: 'logisticsDelta', accent: '#0369a1' },
  { label: '服务', scoreKey: 'serviceScore', deltaKey: 'serviceDelta', accent: '#15803d' },
]

export function formatShopScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

export function formatShopScoreDelta(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return '—'
  if (delta === 0) return '0.00'
  const abs = Math.abs(delta).toFixed(2)
  return delta > 0 ? `+${abs}` : `-${abs}`
}

/** 当前体验分指标均为「越高越好」：上涨绿、下降红、持平灰 */
export function shopScoreDeltaTone(delta: number | null | undefined): {
  text: string
  bg: string
  arrow: string
} {
  if (delta == null || !Number.isFinite(delta) || delta === 0) {
    return { text: 'text-slate-500', bg: 'bg-slate-100', arrow: '→' }
  }
  if (delta > 0) {
    return { text: 'text-emerald-700', bg: 'bg-emerald-50', arrow: '↑' }
  }
  return { text: 'text-rose-700', bg: 'bg-rose-50', arrow: '↓' }
}

function formatMd(dateKey: string | null | undefined): string {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return ''
  return dateKey.slice(5)
}

function ScoreDeltaBadge({ delta, size = 'md' }: { delta: number | null; size?: 'sm' | 'md' }) {
  const tone = shopScoreDeltaTone(delta)
  const pad = size === 'sm' ? 'px-1 py-0' : 'px-1.5 py-0.5'
  const text = size === 'sm' ? 'text-[10px]' : 'text-[11px]'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md ${pad} ${text} font-semibold tabular-nums ${tone.bg} ${tone.text}`}
    >
      <span aria-hidden className="leading-none">
        {tone.arrow}
      </span>
      <span>{formatShopScoreDelta(delta)}</span>
    </span>
  )
}

/**
 * 日报长图：四店体验分卡片区（唯一展示位，时间轴不再重复）
 */
export function DailyReportShopScoreSection({
  scores,
  reportDate,
}: {
  scores: DailyReportShopScoreItem[]
  reportDate: string
}) {
  if (!Array.isArray(scores) || scores.length === 0) return null

  const anyAvailable = scores.some((s) => s.available)
  const scoreDates = [
    ...new Set(scores.map((s) => s.scoreDate).filter((d): d is string => Boolean(d))),
  ].sort()

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">店铺体验分</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
            平台体验分快照 · 箭头表示较上次快照（不是日报经营日环比）
          </p>
        </div>
        <div className="shrink-0 text-right text-[10px] leading-snug tabular-nums text-slate-400">
          <div>日报日 {reportDate || '—'}</div>
          <div>
            {!anyAvailable
              ? '暂无体验分快照'
              : scoreDates.length === 1
                ? `快照日 ${scoreDates[0]}`
                : `快照日见各店（${scoreDates.join(' / ')}）`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-0 divide-x divide-slate-100">
        {scores.map((shop) => {
          const scoreMd = formatMd(shop.scoreDate)
          const prevMd = formatMd(shop.previousScoreDate)
          const staleVsReport = Boolean(
            shop.scoreDate && reportDate && shop.scoreDate !== reportDate,
          )
          return (
            <div key={shop.shopKey} className="min-w-0 overflow-hidden px-2.5 py-3 sm:px-3">
              <div
                className="truncate text-[12px] font-semibold leading-tight text-slate-800"
                title={shop.shopName}
              >
                {shop.shopName}
              </div>
              <div
                className={`mt-0.5 text-[10px] tabular-nums ${
                  staleVsReport ? 'text-amber-700' : 'text-slate-400'
                }`}
              >
                {shop.scoreDate
                  ? staleVsReport
                    ? `快照 ${scoreMd}（非日报日）`
                    : `快照 ${scoreMd}`
                  : '无快照'}
              </div>

              {!shop.available ? (
                <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-4 text-center text-[11px] text-slate-400">
                  暂无数据
                </div>
              ) : (
                <>
                  <div className="mt-2 flex min-w-0 items-end gap-1.5">
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400">综合</div>
                      <div className="text-[20px] font-bold leading-none tabular-nums tracking-tight text-slate-900">
                        {formatShopScore(shop.overallScore)}
                      </div>
                    </div>
                    <div className="mb-0.5 min-w-0 shrink-0">
                      <ScoreDeltaBadge delta={shop.overallDelta} />
                    </div>
                  </div>
                  {prevMd ? (
                    <div className="mt-1 text-[10px] leading-tight text-slate-400">
                      较上次快照 {prevMd}
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] leading-tight text-slate-400">无上次快照可比</div>
                  )}

                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {SUB_ITEMS.map((item) => {
                      const score = shop[item.scoreKey]
                      const delta = shop[item.deltaKey]
                      return (
                        <div
                          key={item.scoreKey}
                          className="flex min-w-0 items-center justify-between gap-1"
                        >
                          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: item.accent }}
                              aria-hidden
                            />
                            <span className="shrink-0 text-[10px] text-slate-500">{item.label}</span>
                            <span className="truncate text-[12px] font-semibold tabular-nums text-slate-800">
                              {formatShopScore(score)}
                            </span>
                          </div>
                          <ScoreDeltaBadge delta={delta} size="sm" />
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
