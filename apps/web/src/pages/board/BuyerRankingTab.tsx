import React, { useCallback, useEffect, useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../../components/ui/Pagination'
import { BuyerDisplay } from '../../components/board/BuyerDisplay'
import { OfficialQualitySyncNote } from '../../components/board/OfficialQualitySyncNote'
import { clearBuyerProfileCache } from '../../lib/buyer-profile-cache'
import {
  BuyerSummaryDrawer,
  type BuyerSummaryKey,
} from '../../components/board/BuyerSummaryDrawer'
import { MetricStatLabel } from '../../components/board/MetricStatLabel'
import { MetricInfoTooltip } from '../../components/board/MetricInfoTooltip'
import { getMetricExplain } from '../../lib/metricExplain'
import { BuyerOrderDrawer } from '../../components/board/BuyerOrderDrawer'
import {
  buyerCardPendingAfterSaleCount,
  buyerCardEarnedAmount,
  buyerCardQualityReturnCount,
  buyerCardRefundTimes,
  buyerCardRealDealOrderCount,
  buyerDisplayLabel,
  buyerRankingTabEmptyMessage,
  isLowPriceBrushBuyerRow,
} from '../../lib/board-orders-filter'
import {
  fetchBuyerProfile,
  refreshBuyerProfile,
  rowToDrawerBuyer,
  type BuyerProfileData,
  type BuyerProfileSummary,
} from '../../lib/buyer-profile'
import { CookieHealthBanner } from '../../components/board/CookieHealthBanner'
import { BuyerRankingProgressCard } from '../../components/board/BuyerRankingProgressCard'
import { useBoardLiveQuery } from '../../providers/BoardLiveQueryProvider'
import { isBusinessSyncActive } from '../../lib/business-sync-ui'
import {
  deriveBuyerRankingUiState,
  hasBuyerProfileCache,
  isBuyerProfileCacheCompatible,
  resolveBuyerRankingHeaderHint,
  resolveBuyerRankingMainCard,
  shouldShowBuyerRankingItems,
} from '../../lib/buyer-ranking-ui'
import { AnimatedTabs } from '../../components/ui/AnimatedTabs'
import { MetricGridTransition, StaggerCard } from '../../components/ui/MetricGridTransition'

const RANKING_TABS: Array<{ key: string; label: string }> = [
  { key: 'spend', label: '消费排行' },
  { key: 'repurchase', label: '复购排行' },
  { key: 'refund', label: '退款排行' },
  { key: 'quality', label: '品退排行' },
]

const SUMMARY_CARDS: Array<{
  key: BuyerSummaryKey
  label: string
  metricKey: 'highValueCount' | 'repurchaseCount' | 'refundCustomerCount' | 'qualityHeavyCount'
}> = [
  { key: 'highValue', label: '高价值客户数', metricKey: 'highValueCount' },
  { key: 'repurchase', label: '复购客户数', metricKey: 'repurchaseCount' },
  { key: 'refund', label: '退款客户数', metricKey: 'refundCustomerCount' },
  { key: 'qualityHeavy', label: '品退客户数', metricKey: 'qualityHeavyCount' },
]

const TAG_COLORS: Record<string, string> = {
  优质客户: 'bg-emerald-100 text-emerald-800',
  复购客户: 'bg-pink-100 text-pink-800',
  售后偏多: 'bg-amber-100 text-amber-800',
  品退: 'bg-red-100 text-red-800',
  品退偏多: 'bg-red-100 text-red-800',
}

const ALLOWED_TAGS = new Set(['优质客户', '复购客户', '售后偏多', '品退', '品退偏多'])

const SUMMARY_FIELD_MAP: Record<BuyerSummaryKey, keyof BuyerProfileSummary> = {
  highValue: 'highValueCount',
  repurchase: 'repurchaseCount',
  refund: 'refundCount',
  qualityHeavy: 'qualityHeavyCount',
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '尚未生成'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export const BuyerRankingTab: React.FC = () => {
  const { formatMoney, formatCount } = useAmountDisplay()
  const { cookieHealth, syncMeta } = useBoardLiveQuery()

  const [profile, setProfile] = useState<BuyerProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [rankingTab, setRankingTab] = useState('spend')
  const [page, setPage] = useState(1)
  const [summaryDrawer, setSummaryDrawer] = useState<BuyerSummaryKey | null>(null)
  const [orderDrawerBuyer, setOrderDrawerBuyer] = useState<ReturnType<
    typeof rowToDrawerBuyer
  > | null>(null)
  const pageSize = 20

  const buyerProfileStatus = syncMeta?.buyerProfileStatus

  const load = useCallback(async (tab: string, pageNo: number) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchBuyerProfile({
        rankingTab: tab,
        page: pageNo,
        pageSize,
      })
      clearBuyerProfileCache()
      setProfile(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载买家画像失败')
      setProfile(null)
      clearBuyerProfileCache()
    } finally {
      setLoading(false)
    }
  }, [pageSize])

  useEffect(() => {
    void load(rankingTab, page)
  }, [load, rankingTab, page])

  const hasCache = hasBuyerProfileCache(profile)
  const cacheCompatible = isBuyerProfileCacheCompatible(profile)
  const buyerUiState = deriveBuyerRankingUiState({
    loading,
    profile,
    error,
    buyerProfileStatus,
    refreshBusy,
  })
  const mainCardVariant = resolveBuyerRankingMainCard(buyerUiState, hasCache)
  const isProfileRebuilding =
    buyerUiState === 'building' ||
    buyerProfileStatus?.rebuilding === true ||
    profile?.rebuilding === true
  const isBusinessSyncing = isBusinessSyncActive(syncMeta?.businessSync.status)
  const headerHint = resolveBuyerRankingHeaderHint({
    uiState: buyerUiState,
    hasCache,
    isBusinessSyncing,
    isProfileRebuilding,
  })
  const showRankingContent = shouldShowBuyerRankingItems(profile, buyerProfileStatus)
  const displayProfile = showRankingContent ? profile : null

  const handleRebuild = useCallback(async () => {
    setRefreshBusy(true)
    setError(null)
    try {
      await refreshBuyerProfile()
      clearBuyerProfileCache()
      await load(rankingTab, page)
    } catch (e) {
      setError(e instanceof Error ? e.message : '重建买家排行失败')
    } finally {
      setRefreshBusy(false)
    }
  }, [load, rankingTab, page])

  useEffect(() => {
    const shouldPoll =
      isProfileRebuilding ||
      buyerUiState === 'stuck' ||
      (profile?.cacheStale && !cacheCompatible)
    if (!shouldPoll) return
    const timer = window.setInterval(() => {
      void load(rankingTab, page)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [isProfileRebuilding, buyerUiState, profile?.cacheStale, cacheCompatible, load, rankingTab, page])

  const summary = displayProfile?.summary ?? null
  const sampleMeta = displayProfile?.sampleMeta ?? null
  const highValueDef = displayProfile?.highValueCustomerDefinition ?? null

  const items = (displayProfile?.items ?? []).filter(
    (row) => !isLowPriceBrushBuyerRow(row as Record<string, unknown>),
  )
  const listBusy = loading && !profile
  const total = displayProfile?.pagination?.total ?? items.length

  const summaryCount = (key: BuyerSummaryKey) => {
    if (!summary) return 0
    return Number(summary[SUMMARY_FIELD_MAP[key]] ?? 0)
  }

  const progressMessage =
    error ??
    buyerProfileStatus?.lastError ??
    buyerProfileStatus?.message ??
    undefined

  return (
    <div className="mx-auto max-w-6xl space-y-3" data-testid="buyer-ranking-page">
      <CookieHealthBanner cookieHealth={cookieHealth} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-slate-900">买家排行</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            全量客户画像（历史累计）· 不随经营看板日期切换
          </p>

          {headerHint === 'rebuilding_with_cache' ? (
            <p className="mt-1 text-[11px] font-medium text-amber-700">
              买家画像正在更新，当前展示最近一次画像结果。
            </p>
          ) : headerHint === 'business_sync_light' ? (
            <p className="mt-1 text-[11px] text-sky-800">
              经营数据正在更新，买家画像会在重建后刷新。
            </p>
          ) : headerHint === 'last_updated' ? (
            <>
              <p className="mt-1 text-[11px] text-slate-600">
                买家排行最后更新：
                <span className="font-medium text-rose-800">
                  {formatUpdatedAt(sampleMeta?.lastUpdatedAt ?? profile?.updatedAt ?? null)}
                </span>
              </p>
              {sampleMeta?.sampleStartTime && sampleMeta?.sampleEndTime ? (
                <p className="mt-0.5 text-[11px] text-slate-600">
                  样本范围：
                  <span className="font-medium text-slate-800">
                    {sampleMeta.sampleStartTime} 至 {sampleMeta.sampleEndTime}
                  </span>
                  <span className="text-slate-400">
                    {' '}
                    · {formatCount(sampleMeta.sampleOrderCount)} 笔历史订单 ·{' '}
                    {formatCount(sampleMeta.sampleCustomerCount)} 位客户
                  </span>
                </p>
              ) : profile?.orderCount != null ? (
                <p className="mt-0.5 text-[11px] text-slate-600">
                  样本范围：
                  <span className="text-slate-400">
                    {formatCount(profile.orderCount)} 笔历史订单 · {formatCount(profile.buyerCount)}{' '}
                    位客户
                  </span>
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-slate-600">更新频率：每天凌晨 3 点自动更新</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                <span className="inline-flex items-center gap-1">
                  {sampleMeta?.sampleDescription ?? '按支付时间统计，客户按买家ID去重。'}
                  退款数据来自已匹配成功的售后记录；品退优先来自官方品质负反馈接口并与售后交叉印证。
                  <MetricInfoTooltip text={getMetricExplain('buyerRankingSample')} />
                </span>
              </p>
              <OfficialQualitySyncNote
                qualityFeedback={profile?.qualityFeedback}
                showLastUpdated
              />
            </>
          ) : null}
        </div>
      </div>

      {buyerUiState === 'loading' ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-500">
          正在加载买家画像…
        </div>
      ) : null}

      {error && !hasCache && buyerUiState !== 'failed' ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
          <button
            type="button"
            className="ml-3 text-xs font-medium underline"
            onClick={() => void load(rankingTab, page)}
          >
            重试
          </button>
        </div>
      ) : null}

      {mainCardVariant ? (
        <BuyerRankingProgressCard
          variant={mainCardVariant}
          progress={buyerProfileStatus?.progress}
          message={progressMessage}
          onRebuild={() => void handleRebuild()}
          rebuildBusy={refreshBusy}
        />
      ) : null}

      {!showRankingContent && hasCache && (isProfileRebuilding || !cacheCompatible) ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          买家画像正在更新，旧版排行数据已隐藏，完成后将自动刷新。
        </p>
      ) : null}

      {showRankingContent && (
      <>
      <div className="rounded-2xl border border-rose-100/50 bg-white/80 p-1.5 board-fade-in">
        <AnimatedTabs
          items={RANKING_TABS}
          activeKey={rankingTab}
          onChange={(key) => {
            if (key === rankingTab) return
            setPage(1)
            setRankingTab(key)
          }}
          variant="pills"
        />
      </div>

      {summary && !error && (
        <>
        <MetricGridTransition transitionKey={`summary-${profile?.updatedAt ?? 'empty'}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SUMMARY_CARDS.map((c, i) => (
            <StaggerCard key={c.key} index={i}>
            <button
              type="button"
              onClick={() => {
                const count = summaryCount(c.key)
                if (count <= 0) return
                setSummaryDrawer(c.key)
              }}
              className="rounded-2xl border border-rose-100/60 bg-gradient-to-br from-white to-rose-50/40 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="text-[11px] text-slate-500">
                <MetricStatLabel
                  label={c.label}
                  metricKey={c.metricKey}
                  infoText={
                    c.key === 'highValue' && highValueDef?.ruleText
                      ? `${getMetricExplain('highValueCount')} ${highValueDef.ruleText}`
                      : undefined
                  }
                />
              </div>
              <div
                key={`${c.key}-${summaryCount(c.key)}-${rankingTab}`}
                className="board-number-pop mt-1 text-2xl font-semibold text-rose-900"
              >
                {formatCount(summaryCount(c.key))}
              </div>
            </button>
            </StaggerCard>
          ))}
        </div>
        </MetricGridTransition>
        {highValueDef?.ruleText ? (
          <p className="text-[10px] leading-relaxed text-slate-500">
            {highValueDef.label}：{highValueDef.ruleText}
          </p>
        ) : null}
        </>
      )}

      <MetricGridTransition transitionKey={`list-${rankingTab}-${page}`}>
      <div
        className={`grid gap-3 md:grid-cols-2 ${
          listBusy ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        {listBusy && items.length === 0 ? (
          <p className="col-span-full rounded-2xl bg-white py-10 text-center text-xs text-slate-400">
            正在加载买家排行…
          </p>
        ) : items.length === 0 ? (
          (() => {
            const empty =
              profile?.buyerCount === 0
                ? {
                    title: '暂无买家排行数据',
                    subtitle: '系统每天凌晨 3 点自动更新买家排行，请稍后再查看。',
                  }
                : buyerRankingTabEmptyMessage(rankingTab)
            return (
              <div className="col-span-full rounded-2xl bg-white py-10 text-center">
                <p className="text-xs text-slate-500">{empty.title}</p>
                {'subtitle' in empty && empty.subtitle ? (
                  <p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-slate-400">
                    {empty.subtitle}
                  </p>
                ) : null}
              </div>
            )
          })()
        ) : (
          items.map((row, idx) => {
            const tags = (Array.isArray(row.customerTags) ? row.customerTags : [])
              .map(String)
              .filter((t) => ALLOWED_TAGS.has(t))
            const displayLabel = buyerDisplayLabel(row)
            const shortCode = String(row.buyerShortCode ?? row.buyerIdentityCode ?? '').trim()
            const earnedAmount = buyerCardEarnedAmount(row)
            const realDealOrderCount = buyerCardRealDealOrderCount(row)
            const refundCount = buyerCardRefundTimes(row)
            const qualityReturnCount = buyerCardQualityReturnCount(row)
            const pendingAfterSaleCount = buyerCardPendingAfterSaleCount(row)
            const orderCount = Number(row.orderCount ?? 0)
            const refundRate =
              orderCount > 0 ? `${Math.round((refundCount / orderCount) * 100)}%` : '—'
            const qualityRate =
              orderCount > 0 ? `${Math.round((qualityReturnCount / orderCount) * 100)}%` : '—'
            const rank = (page - 1) * pageSize + idx + 1
            return (
              <article
                key={`${rankingTab}-${String(row.buyerKey ?? row.buyerId)}`}
                role="button"
                tabIndex={0}
                style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
                className="board-list-row-enter flex cursor-pointer flex-col rounded-2xl border border-rose-100/50 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => setOrderDrawerBuyer(rowToDrawerBuyer(row))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setOrderDrawerBuyer(rowToDrawerBuyer(row))
                }}
              >
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className="text-base font-semibold text-slate-900"
                        title="同名买家已按买家ID区分"
                      >
                        {displayLabel}
                      </p>
                      <span className="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        #{rank}
                      </span>
                    </div>
                    {shortCode && shortCode !== '—' ? (
                      <p className="truncate text-[10px] text-slate-400">
                        识别码 {shortCode}
                      </p>
                    ) : null}
                    {tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <span
                            key={t}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TAG_COLORS[t] ?? ''}`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1 text-[10px] text-slate-500">
                      建议：{String(row.suggestion ?? '—')}
                    </p>
                  </div>
                  <div className="text-right text-[10px]">
                    <div className="inline-flex items-center justify-end gap-0.5 text-slate-400">
                      赚到金额
                      <MetricInfoTooltip text={getMetricExplain('earnedAmount')} />
                    </div>
                    <div className="text-lg font-bold text-rose-900">
                      {formatMoney(earnedAmount)}
                    </div>
                    {rankingTab === 'repurchase' ? (
                      <div className="mt-1 text-slate-500">
                        成交 {formatCount(realDealOrderCount)} 单
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  <span>成交订单数 {formatCount(realDealOrderCount)}</span>
                  <span>退款订单数 {formatCount(refundCount)}</span>
                  <span>品退订单数 {formatCount(qualityReturnCount)}</span>
                  <span>退款率 {refundRate}</span>
                  {rankingTab === 'quality' ? (
                    <span>品退率 {qualityRate}</span>
                  ) : null}
                  {pendingAfterSaleCount > 0 ? (
                    <span>售后中 {formatCount(pendingAfterSaleCount)}</span>
                  ) : null}
                </div>
                <div className="mt-3 flex justify-end border-t border-rose-50 pt-3 text-[11px] text-rose-600">
                  点击查看历史订单 →
                </div>
              </article>
            )
          })
        )}
      </div>
      </MetricGridTransition>
      {total > 0 && <Pagination page={page} total={total} pageSize={pageSize} onPage={setPage} />}
      </>
      )}
      <BuyerSummaryDrawer
        open={summaryDrawer !== null}
        onClose={() => {
          setSummaryDrawer(null)
        }}
        summaryKey={summaryDrawer ?? 'highValue'}
        cardCount={summaryDrawer ? summaryCount(summaryDrawer) : undefined}
        onViewBuyerOrders={(b) => setOrderDrawerBuyer(b)}
      />
      <BuyerOrderDrawer
        open={orderDrawerBuyer !== null}
        onClose={() => setOrderDrawerBuyer(null)}
        buyer={orderDrawerBuyer}
      />
    </div>
  )
}

