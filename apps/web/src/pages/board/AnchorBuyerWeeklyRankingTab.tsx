import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../../components/ui/Pagination'
import { AnimatedTabs } from '../../components/ui/AnimatedTabs'
import { StaggerCard } from '../../components/ui/MetricGridTransition'
import { BuyerDisplay } from '../../components/board/BuyerDisplay'
import { BuyerOrderDrawer } from '../../components/board/BuyerOrderDrawer'
import { useAnchorFilterOptions } from '../../hooks/useAnchorFilterOptions'
import { useAuth } from '../../providers/AuthProvider'
import {
  fetchAnchorWeeklyRanking,
  weeklyItemToDrawerBuyer,
  type AnchorWeeklyBuyerRankingItem,
  type AnchorWeeklyOrderScope,
  type AnchorWeeklyRankingPreset,
  type AnchorWeeklyRankingTab,
} from '../../lib/anchor-weekly-ranking'

const PRESET_OPTIONS: Array<{ key: AnchorWeeklyRankingPreset; label: string }> = [
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'custom', label: '自定义' },
]

const RANKING_TABS: Array<{ key: AnchorWeeklyRankingTab; label: string }> = [
  { key: 'spend', label: '成交榜' },
  { key: 'repurchase', label: '复购榜' },
  { key: 'refund', label: '退款关注' },
  { key: 'quality', label: '品退关注' },
]

const TAG_COLORS: Record<string, string> = {
  优质客户: 'bg-emerald-100 text-emerald-800',
  复购客户: 'bg-pink-100 text-pink-800',
  售后偏多: 'bg-amber-100 text-amber-800',
  品退: 'bg-red-100 text-red-800',
  品退偏多: 'bg-red-100 text-red-800',
}

function isAdminRole(role: string | undefined): boolean {
  return role === 'super_admin' || role === 'boss' || role === 'local_viewer'
}

export const AnchorBuyerWeeklyRankingTab: React.FC = () => {
  const { formatMoney, formatCount } = useAmountDisplay()
  const { user } = useAuth()
  const { filterNames, loading: anchorsLoading } = useAnchorFilterOptions()

  const [preset, setPreset] = useState<AnchorWeeklyRankingPreset>('thisWeek')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [rankingTab, setRankingTab] = useState<AnchorWeeklyRankingTab>('spend')
  const [anchorName, setAnchorName] = useState('全部')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchAnchorWeeklyRanking>> | null>(
    null,
  )
  const [drawerBuyer, setDrawerBuyer] = useState<ReturnType<typeof weeklyItemToDrawerBuyer> | null>(
    null,
  )
  const [drawerScope, setDrawerScope] = useState<AnchorWeeklyOrderScope | null>(null)
  const pageSize = 20

  const showAnchorPicker = isAdminRole(user?.role)

  const effectiveAnchorName = useMemo(() => {
    if (data?.anchorScope.mode === 'anchor' && data.anchorScope.anchorName) {
      return data.anchorScope.anchorName
    }
    if (showAnchorPicker && anchorName !== '全部') return anchorName
    return undefined
  }, [anchorName, data?.anchorScope, showAnchorPicker])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAnchorWeeklyRanking({
        preset,
        startDate: preset === 'custom' ? customStart : undefined,
        endDate: preset === 'custom' ? customEnd : undefined,
        rankingTab,
        anchorName: showAnchorPicker ? anchorName : undefined,
        page,
        pageSize,
      })
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载主播周榜失败')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [anchorName, customEnd, customStart, page, pageSize, preset, rankingTab, showAnchorPicker])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [preset, customStart, customEnd, rankingTab, anchorName])

  const openWeeklyOrders = (item: AnchorWeeklyBuyerRankingItem) => {
    if (!data) return
    setDrawerScope({
      startDate: data.range.startDate,
      endDate: data.range.endDate,
      anchorName: effectiveAnchorName,
      source: 'anchor_weekly_ranking',
    })
    setDrawerBuyer(weeklyItemToDrawerBuyer(item))
  }

  const emptyMessage =
    data?.message ?? data?.emptyText ?? '本周暂时没有符合条件的客户，不代表主播表现不好，可能是本周该类客户少。'

  return (
    <div className="mx-auto max-w-6xl space-y-3" data-testid="anchor-weekly-ranking-page">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">主播周榜</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          看本周自己的客户：谁成交多、谁复购、谁退款多、谁有品退，方便下播后跟进。
        </p>
        {data?.dataNote ? (
          <p className="mt-1 text-[11px] text-slate-500">{data.dataNote}</p>
        ) : null}
        {data?.range ? (
          <p className="mt-1 text-[11px] text-slate-600">
            统计周期：
            <span className="font-medium text-slate-800">
              {data.range.startDate} 至 {data.range.endDate}
            </span>
            {data.generatedAt ? (
              <span className="text-slate-400"> · 生成于 {data.generatedAt}</span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESET_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setPreset(opt.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              preset === opt.key
                ? 'bg-rose-500 text-white'
                : 'border border-rose-100 bg-white text-rose-700 hover:bg-rose-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {preset === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
            />
            <span className="text-xs text-slate-400">至</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
            />
          </div>
        ) : null}
        {showAnchorPicker ? (
          <select
            value={anchorName}
            onChange={(e) => setAnchorName(e.target.value)}
            disabled={anchorsLoading}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            data-testid="anchor-weekly-ranking-anchor-select"
          >
            {filterNames.map((name) => (
              <option key={name} value={name}>
                {name === '全部' ? '全部主播' : name}
              </option>
            ))}
          </select>
        ) : data?.anchorScope.mode === 'anchor' && data.anchorScope.anchorName ? (
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs text-rose-800">
            当前主播：{data.anchorScope.anchorName}
          </span>
        ) : null}
      </div>

      <AnimatedTabs
        items={RANKING_TABS}
        activeKey={rankingTab}
        onChange={(key) => setRankingTab(key as AnchorWeeklyRankingTab)}
        testIdPrefix="anchor-weekly-ranking-tab"
      />

      {loading && !data ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          正在加载本周客户情况…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {!loading && data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-sm text-slate-600">{emptyMessage}</p>
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="space-y-2">
          {data.items.map((item, index) => (
            <StaggerCard key={`${item.buyerKey}-${item.rank}`} index={index}>
              <div className="rounded-2xl border border-rose-100/80 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-rose-600">#{item.rank}</p>
                    <BuyerDisplay
                      nickname={item.buyerDisplayName}
                      identityCode={item.buyerShortCode !== '—' ? item.buyerShortCode : undefined}
                      className="mt-0.5 text-base font-semibold text-slate-900"
                    />
                    {item.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              TAG_COLORS[tag] ?? 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">本周成交金额</p>
                    <p className="text-xl font-bold tabular-nums text-rose-900">
                      {formatMoney(item.weeklyDealAmountYuan)}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  成交 {formatCount(item.weeklyRealDealOrderCount)} 单 · 退款{' '}
                  {formatCount(item.weeklyRefundOrderCount)} 单 · 品退{' '}
                  {formatCount(item.weeklyQualityRefundOrderCount)} 单
                </p>
                {item.suggestion && item.suggestion !== '—' ? (
                  <p className="mt-1 text-xs text-slate-500">建议：{item.suggestion}</p>
                ) : null}
                {item.canOpenOrders ? (
                  <button
                    type="button"
                    onClick={() => openWeeklyOrders(item)}
                    className="mt-3 text-xs font-medium text-rose-700 hover:underline"
                  >
                    查看本周订单 →
                  </button>
                ) : null}
              </div>
            </StaggerCard>
          ))}
          <Pagination
            page={data.pagination.page}
            total={data.pagination.total}
            pageSize={data.pagination.pageSize}
            onPage={setPage}
          />
        </div>
      ) : null}

      <BuyerOrderDrawer
        open={!!drawerBuyer}
        onClose={() => {
          setDrawerBuyer(null)
          setDrawerScope(null)
        }}
        buyer={drawerBuyer}
        scope={drawerScope ?? undefined}
      />
    </div>
  )
}
