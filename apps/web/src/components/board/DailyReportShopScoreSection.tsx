import React, { useMemo } from 'react'

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

/** 日报体验分固定展示顺序（缺数据也占位） */
export const DAILY_REPORT_SHOP_SCORE_ORDER = [
  'shiyuju',
  'xyxiangyu',
  'hetianyayu',
  'xiangyu',
] as const

const SHOP_NAME_BY_KEY: Record<string, string> = {
  shiyuju: '拾玉居和田玉',
  xyxiangyu: 'XY祥钰珠宝',
  hetianyayu: '和田雅玉',
  xiangyu: '祥钰珠宝',
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

/** 官方综合分展示：1 位小数 */
export function formatOverallShopScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return (Math.round(value * 10) / 10).toFixed(1)
}

/** 分项分数：保留 2 位小数 */
export function formatShopScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

export function formatShopScoreDelta(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return '—'
  if (delta === 0) return '0.0'
  const abs = (Math.round(Math.abs(delta) * 10) / 10).toFixed(1)
  return delta > 0 ? `+${abs}` : `-${abs}`
}

export type ShopScoreTrendLabel = '上升' | '下降' | '持平'

/** delta > 0 上升；< 0 下降；= 0 / 无效 持平 */
export function shopScoreTrendLabel(delta: number | null | undefined): ShopScoreTrendLabel {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return '持平'
  return delta > 0 ? '上升' : '下降'
}

export function shopScoreDeltaTone(delta: number | null | undefined): {
  text: string
  bg: string
  label: ShopScoreTrendLabel
} {
  const label = shopScoreTrendLabel(delta)
  if (label === '上升') {
    return { text: 'text-emerald-700', bg: 'bg-emerald-50', label }
  }
  if (label === '下降') {
    return { text: 'text-rose-700', bg: 'bg-rose-50', label }
  }
  return { text: 'text-slate-500', bg: 'bg-slate-100', label }
}

function TrendBadge({
  delta,
  size = 'md',
  withDeltaValue = false,
}: {
  delta: number | null
  size?: 'sm' | 'md'
  /** 综合分旁可带简洁数值，分项只显示文字以免拥挤 */
  withDeltaValue?: boolean
}) {
  const tone = shopScoreDeltaTone(delta)
  const pad = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'
  const text = size === 'sm' ? 'text-[10px]' : 'text-[11px]'
  const showValue =
    withDeltaValue && delta != null && Number.isFinite(delta) && delta !== 0
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md ${pad} ${text} font-semibold ${tone.bg} ${tone.text}`}
    >
      <span>{tone.label}</span>
      {showValue ? (
        <span className="tabular-nums font-medium">{formatShopScoreDelta(delta)}</span>
      ) : null}
    </span>
  )
}

function emptyPlaceholder(shopKey: string): DailyReportShopScoreItem {
  return {
    shopKey,
    shopName: SHOP_NAME_BY_KEY[shopKey] ?? shopKey,
    scoreDate: null,
    previousScoreDate: null,
    overallScore: null,
    overallDelta: null,
    qualityScore: null,
    logisticsScore: null,
    serviceScore: null,
    qualityDelta: null,
    logisticsDelta: null,
    serviceDelta: null,
    available: false,
  }
}

/** 按固定顺序排列；缺失店铺补占位，不因数据打乱顺序 */
export function orderDailyReportShopScores(
  scores: DailyReportShopScoreItem[],
): DailyReportShopScoreItem[] {
  const byKey = new Map(
    (Array.isArray(scores) ? scores : []).map((s) => [s.shopKey, s] as const),
  )
  return DAILY_REPORT_SHOP_SCORE_ORDER.map((key) => {
    const hit = byKey.get(key)
    if (!hit) return emptyPlaceholder(key)
    return {
      ...hit,
      shopName: SHOP_NAME_BY_KEY[key] ?? hit.shopName,
    }
  })
}

/**
 * 日报长图：四店体验分卡片区（唯一展示位）
 */
export function DailyReportShopScoreSection({
  scores,
}: {
  scores: DailyReportShopScoreItem[]
  /** @deprecated 仅兼容旧调用，界面不再展示日期 */
  reportDate?: string
}) {
  const ordered = useMemo(() => orderDailyReportShopScores(scores), [scores])
  if (!ordered.length) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-800">店铺体验分</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
          平台体验分展示 · 仅供店铺状态参考
        </p>
      </div>

      <div className="grid grid-cols-4 gap-0 divide-x divide-slate-100">
        {ordered.map((shop) => (
          <div
            key={shop.shopKey}
            className="flex min-h-[168px] min-w-0 flex-col overflow-hidden px-2.5 py-3"
          >
            <div
              className="line-clamp-2 min-h-[32px] text-[12px] font-semibold leading-snug text-slate-800"
              title={shop.shopName}
            >
              {shop.shopName}
            </div>

            {!shop.available ? (
              <div className="mt-3 flex flex-1 flex-col justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-4 text-center text-[11px] text-slate-400">
                <div className="text-[20px] font-bold tabular-nums text-slate-300">—</div>
                <div className="mt-2">暂无数据</div>
              </div>
            ) : (
              <>
                <div className="mt-2 flex min-w-0 items-end gap-1.5">
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-400">综合</div>
                    <div className="text-[22px] font-bold leading-none tabular-nums tracking-tight text-slate-900">
                      {formatOverallShopScore(shop.overallScore)}
                    </div>
                  </div>
                  <div className="mb-0.5 shrink-0">
                    <TrendBadge delta={shop.overallDelta} withDeltaValue />
                  </div>
                </div>

                <div className="mt-2.5 flex-1 space-y-1.5 border-t border-slate-100 pt-2">
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
                        <TrendBadge delta={delta} size="sm" />
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
