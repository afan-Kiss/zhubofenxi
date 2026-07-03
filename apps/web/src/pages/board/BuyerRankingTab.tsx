import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../../components/ui/Pagination'
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
  buyerCardEarnedAmount,
  buyerDisplayLabel,
  buyerRankingTabEmptyMessage,
  isLowPriceBrushBuyerRow,
} from '../../lib/board-orders-filter'
import {
  fetchBadBuyerRanking,
  fetchBuyerProfile,
  fetchBuyerValueRanking,
  fetchWechatWeeklyBuyerText,
  refreshBuyerProfile,
  rowToDrawerBuyer,
  type BadBuyerRankingData,
  type BuyerProfileData,
  type BuyerProfileSummary,
  type BuyerValueRankingData,
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
import { ViewportModal, FloatingToast } from '../../components/ui/ViewportModal'
import { copyTextFromTextarea, copyTextToClipboard } from '../../lib/copy-to-clipboard'

const RANKING_TABS: Array<{ key: string; label: string }> = [
  { key: 'highValue', label: '高价值客户榜单' },
  { key: 'highAov', label: '高客单榜' },
  { key: 'stableSigned', label: '稳定签收榜' },
  { key: 'repurchase', label: '复购榜' },
  { key: 'badBuyer', label: '高风险售后客户' },
  { key: 'quality', label: '品退榜' },
]

const WECHAT_PRESET_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'custom', label: '自定义' },
]

const VALUE_RANKING_PRESET_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'last30d', label: '最近30天' },
  { key: 'last90d', label: '最近90天' },
  { key: 'thisYear', label: '今年' },
  { key: 'all', label: '全量历史' },
  { key: 'custom', label: '自定义' },
]

const VALUE_RANKING_TYPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'true_high_value', label: '真正高价值客户' },
  { key: 'high_spend_need_attention', label: '高消费但需关注' },
  { key: 'potential', label: '潜力客户' },
]

const BAD_BUYER_PRESET_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'recent7', label: '最近7天' },
  { key: 'recent15', label: '最近15天' },
  { key: 'recent30', label: '最近30天' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'custom', label: '自定义' },
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
  高价值: 'bg-emerald-100 text-emerald-800',
  高客单: 'bg-sky-100 text-sky-800',
  稳定签收: 'bg-teal-100 text-teal-800',
  复购客户: 'bg-pink-100 text-pink-800',
  售后关注: 'bg-amber-100 text-amber-800',
  普通维护: 'bg-slate-100 text-slate-700',
  优质客户: 'bg-emerald-100 text-emerald-800',
  售后偏多: 'bg-amber-100 text-amber-800',
  品退: 'bg-red-100 text-red-800',
  品退偏多: 'bg-red-100 text-red-800',
}

function badBuyerProfileFromRow(row: Record<string, unknown>) {
  return (row.badBuyerProfile ?? {}) as Record<string, unknown>
}

function valueProfileFromRow(row: Record<string, unknown>) {
  return (row.valueProfile ?? {}) as Record<string, unknown>
}

function valueRankingProfileFromRow(row: Record<string, unknown>) {
  return (row.valueRankingProfile ?? {}) as Record<string, unknown>
}

function valueRankingMetricsFromProfile(vp: Record<string, unknown>) {
  return (vp.metrics ?? {}) as Record<string, unknown>
}

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
  const [badBuyerData, setBadBuyerData] = useState<BadBuyerRankingData | null>(null)
  const [valueRankingData, setValueRankingData] = useState<BuyerValueRankingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [rankingTab, setRankingTab] = useState('highValue')
  const [page, setPage] = useState(1)
  const [badBuyerPreset, setBadBuyerPreset] = useState('recent30')
  const [badBuyerCustomStart, setBadBuyerCustomStart] = useState('')
  const [badBuyerCustomEnd, setBadBuyerCustomEnd] = useState('')
  const [valueRankingPreset, setValueRankingPreset] = useState('last90d')
  const [valueRankingType, setValueRankingType] = useState('true_high_value')
  const [valueRankingCustomStart, setValueRankingCustomStart] = useState('')
  const [valueRankingCustomEnd, setValueRankingCustomEnd] = useState('')
  const [wechatPreset, setWechatPreset] = useState('thisWeek')
  const [wechatCustomStart, setWechatCustomStart] = useState('')
  const [wechatCustomEnd, setWechatCustomEnd] = useState('')
  const [wechatCopyBusy, setWechatCopyBusy] = useState(false)
  const [wechatToast, setWechatToast] = useState<string | null>(null)
  const [wechatModalText, setWechatModalText] = useState<string | null>(null)
  const wechatTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [summaryDrawer, setSummaryDrawer] = useState<BuyerSummaryKey | null>(null)
  const [orderDrawerBuyer, setOrderDrawerBuyer] = useState<ReturnType<
    typeof rowToDrawerBuyer
  > | null>(null)
  const [orderDrawerScope, setOrderDrawerScope] = useState<{
    startDate: string
    endDate: string
    source: 'bad_buyer_ranking'
  } | null>(null)
  const pageSize = 20

  const buyerProfileStatus = syncMeta?.buyerProfileStatus
  const isBadBuyerTab = rankingTab === 'badBuyer'
  const isHighValueTab = rankingTab === 'highValue'

  const load = useCallback(async (tab: string, pageNo: number) => {
    if (tab === 'highValue') {
      if (
        valueRankingPreset === 'custom' &&
        (!valueRankingCustomStart.trim() || !valueRankingCustomEnd.trim())
      ) {
        setValueRankingData(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const data = await fetchBuyerValueRanking({
          preset: valueRankingPreset,
          startDate: valueRankingPreset === 'custom' ? valueRankingCustomStart : undefined,
          endDate: valueRankingPreset === 'custom' ? valueRankingCustomEnd : undefined,
          type: valueRankingType,
          limit: 50,
        })
        setValueRankingData(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载高价值客户榜单失败')
        setValueRankingData(null)
      } finally {
        setLoading(false)
      }
      return
    }

    if (tab === 'badBuyer') {
      if (badBuyerPreset === 'custom' && (!badBuyerCustomStart.trim() || !badBuyerCustomEnd.trim())) {
        setBadBuyerData(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const data = await fetchBadBuyerRanking({
          preset: badBuyerPreset,
          startDate: badBuyerPreset === 'custom' ? badBuyerCustomStart : undefined,
          endDate: badBuyerPreset === 'custom' ? badBuyerCustomEnd : undefined,
          limit: 10,
        })
        setBadBuyerData(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载高风险售后客户提醒失败')
        setBadBuyerData(null)
      } finally {
        setLoading(false)
      }
      return
    }

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
  }, [
    pageSize,
    badBuyerPreset,
    badBuyerCustomStart,
    badBuyerCustomEnd,
    valueRankingPreset,
    valueRankingType,
    valueRankingCustomStart,
    valueRankingCustomEnd,
  ])

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
  const showRankingContent =
    isBadBuyerTab || isHighValueTab || shouldShowBuyerRankingItems(profile, buyerProfileStatus)
  const displayProfile = showRankingContent && !isBadBuyerTab && !isHighValueTab ? profile : null

  const activeWechatPreset = isBadBuyerTab ? badBuyerPreset : wechatPreset
  const activeWechatCustomStart = isBadBuyerTab ? badBuyerCustomStart : wechatCustomStart
  const activeWechatCustomEnd = isBadBuyerTab ? badBuyerCustomEnd : wechatCustomEnd
  const wechatPresetOptions = isBadBuyerTab ? BAD_BUYER_PRESET_OPTIONS : WECHAT_PRESET_OPTIONS

  const handleWechatCopy = useCallback(async () => {
    if (
      activeWechatPreset === 'custom' &&
      (!activeWechatCustomStart.trim() || !activeWechatCustomEnd.trim())
    ) {
      setWechatToast('请先选择自定义日期范围')
      return
    }
    setWechatCopyBusy(true)
    setWechatToast(null)
    try {
      const result = await fetchWechatWeeklyBuyerText({
        preset: activeWechatPreset,
        startDate: activeWechatPreset === 'custom' ? activeWechatCustomStart : undefined,
        endDate: activeWechatPreset === 'custom' ? activeWechatCustomEnd : undefined,
        limit: 10,
        ranking: isBadBuyerTab ? 'badBuyer' : 'highValue',
      })
      setWechatModalText(result.text)
    } catch (e) {
      setWechatToast(e instanceof Error ? e.message : '生成微信群榜单失败')
    } finally {
      setWechatCopyBusy(false)
    }
  }, [
    activeWechatCustomEnd,
    activeWechatCustomStart,
    activeWechatPreset,
    isBadBuyerTab,
  ])

  const handleWechatModalCopy = useCallback(async () => {
    const ta = wechatTextareaRef.current
    const text = ta?.value ?? wechatModalText ?? ''
    if (!text.trim()) {
      setWechatToast('暂无文案可复制')
      return
    }
    const okFromTextarea = ta ? copyTextFromTextarea(ta) : false
    const ok = okFromTextarea || (await copyTextToClipboard(text))
    setWechatToast(ok ? '已复制，可以粘贴到微信群' : '复制失败，可手动复制下方文案')
  }, [wechatModalText])

  useEffect(() => {
    if (!wechatModalText) return
    const timer = window.setTimeout(() => {
      const ta = wechatTextareaRef.current
      if (!ta) return
      ta.focus()
      ta.select()
      ta.setSelectionRange(0, ta.value.length)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [wechatModalText])

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

  const items = isBadBuyerTab
    ? (badBuyerData?.items ?? []).filter(
        (row) => !isLowPriceBrushBuyerRow(row as Record<string, unknown>),
      )
    : isHighValueTab
      ? (valueRankingData?.items ?? []).filter(
          (row) => !isLowPriceBrushBuyerRow(row as Record<string, unknown>),
        )
      : (displayProfile?.items ?? []).filter(
          (row) => !isLowPriceBrushBuyerRow(row as Record<string, unknown>),
        )
  const listBusy =
    loading && (isBadBuyerTab ? !badBuyerData : isHighValueTab ? !valueRankingData : !profile)
  const total =
    isBadBuyerTab || isHighValueTab
      ? items.length
      : (displayProfile?.pagination?.total ?? items.length)

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
    <div className="mx-auto max-w-6xl space-y-3 px-1 sm:px-0" data-testid="buyer-ranking-page">
      <CookieHealthBanner cookieHealth={cookieHealth} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-slate-900">买家榜单</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            所有主播共用的客户池：看哪些买家值得维护，哪些买家签收稳、客单高、退货少。
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            全量客户画像（历史累计）· 不随经营看板日期切换 · 不按主播区分
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {isBadBuyerTab
              ? '高风险售后客户提醒用于发货前确认细节，不代表不能成交。'
              : '售后关注不是拉黑客户，只是提醒发货前多确认圈口、颜色、瑕疵和预期。'}
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
        <div className="w-full shrink-0 lg:max-w-sm">
          <div
            className={`rounded-2xl border p-3 ${
              isBadBuyerTab
                ? 'border-amber-200 bg-amber-50/50'
                : 'border-emerald-100 bg-emerald-50/40'
            }`}
          >
            <p
              className={`mb-2 text-xs font-medium ${
                isBadBuyerTab ? 'text-amber-900' : 'text-emerald-900'
              }`}
            >
              微信群榜单文案
            </p>
            <div className="flex flex-col gap-2">
              <select
                className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                value={activeWechatPreset}
                onChange={(e) => {
                  const v = e.target.value
                  if (isBadBuyerTab) {
                    setBadBuyerPreset(v)
                  } else {
                    setWechatPreset(v)
                  }
                }}
                data-testid="wechat-weekly-preset"
              >
                {wechatPresetOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              {activeWechatPreset === 'custom' ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <input
                    type="date"
                    className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={activeWechatCustomStart}
                    onChange={(e) => {
                      if (isBadBuyerTab) setBadBuyerCustomStart(e.target.value)
                      else setWechatCustomStart(e.target.value)
                    }}
                  />
                  <span className="hidden text-center text-xs text-slate-400 sm:block">至</span>
                  <input
                    type="date"
                    className="min-h-[44px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={activeWechatCustomEnd}
                    onChange={(e) => {
                      if (isBadBuyerTab) setBadBuyerCustomEnd(e.target.value)
                      else setWechatCustomEnd(e.target.value)
                    }}
                  />
                </div>
              ) : null}
              <button
                type="button"
                className={`min-h-[44px] w-full rounded-xl px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-60 ${
                  isBadBuyerTab
                    ? 'bg-amber-600 active:bg-amber-800'
                    : 'bg-emerald-600 active:bg-emerald-800'
                }`}
                disabled={wechatCopyBusy}
                onClick={() => void handleWechatCopy()}
                data-testid="copy-wechat-weekly-ranking"
              >
                {wechatCopyBusy
                  ? '正在生成微信群榜单…'
                  : isBadBuyerTab
                    ? '复制高风险售后客户提醒文案'
                    : '复制本周微信群榜单'}
              </button>
              {wechatToast ? null : (
                <p className="text-center text-[10px] leading-relaxed text-slate-500">
                  生成后弹出文案，点「一键复制」粘贴到微信群
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {buyerUiState === 'loading' && !isBadBuyerTab ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-500">
          正在加载买家画像…
        </div>
      ) : null}

      {error && (!hasCache || isBadBuyerTab || isHighValueTab) && buyerUiState !== 'failed' ? (
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

      {mainCardVariant && !isBadBuyerTab ? (
        <BuyerRankingProgressCard
          variant={mainCardVariant}
          progress={buyerProfileStatus?.progress}
          message={progressMessage}
          onRebuild={() => void handleRebuild()}
          rebuildBusy={refreshBusy}
        />
      ) : null}

      {!showRankingContent && hasCache && !isBadBuyerTab && !isHighValueTab && (isProfileRebuilding || !cacheCompatible) ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          买家画像正在更新，旧版排行数据已隐藏，完成后将自动刷新。
        </p>
      ) : null}

      {showRankingContent && (
      <>
      <div className="-mx-1 overflow-x-auto pb-1 board-fade-in">
        <div className="min-w-max rounded-2xl border border-rose-100/50 bg-white/80 p-1.5">
          <AnimatedTabs
            items={RANKING_TABS}
            activeKey={rankingTab}
            onChange={(key) => {
              if (key === rankingTab) return
              setPage(1)
              setRankingTab(key)
            }}
            variant="pills"
            className="flex-nowrap"
            buttonClassName="whitespace-nowrap px-3 py-2 text-xs sm:px-4 sm:py-2.5 sm:text-sm"
          />
        </div>
      </div>

      {summary && !error && !isBadBuyerTab && (
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

      {isHighValueTab ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-emerald-900">
              按支付时间统计 · 支付基数低于 ¥29 已剔除 · 默认最近90天
              {valueRankingData?.range ? (
                <span className="ml-1 font-medium">
                  （{valueRankingData.range.presetLabel}：{valueRankingData.range.startDate} 至{' '}
                  {valueRankingData.range.endDate}）
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                className="min-h-[40px] rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-slate-700"
                value={valueRankingType}
                onChange={(e) => {
                  setValueRankingType(e.target.value)
                  setPage(1)
                }}
                data-testid="value-ranking-type"
              >
                {VALUE_RANKING_TYPE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="min-h-[40px] rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-slate-700"
                value={valueRankingPreset}
                onChange={(e) => {
                  setValueRankingPreset(e.target.value)
                  setPage(1)
                }}
                data-testid="value-ranking-date-preset"
              >
                {VALUE_RANKING_PRESET_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {valueRankingPreset === 'custom' ? (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <input
                type="date"
                className="min-h-[40px] w-full rounded-lg border border-emerald-200 px-3 py-1.5 text-sm"
                value={valueRankingCustomStart}
                onChange={(e) => setValueRankingCustomStart(e.target.value)}
              />
              <span className="hidden text-center text-xs text-slate-400 sm:block">至</span>
              <input
                type="date"
                className="min-h-[40px] w-full rounded-lg border border-emerald-200 px-3 py-1.5 text-sm"
                value={valueRankingCustomEnd}
                onChange={(e) => setValueRankingCustomEnd(e.target.value)}
              />
            </div>
          ) : null}
          {valueRankingData?.summary ? (
            <p className="mt-2 text-[10px] leading-relaxed text-emerald-900/90">
              真正高价值 {formatCount(valueRankingData.summary.trueHighValueCount)} 人｜需关注{' '}
              {formatCount(valueRankingData.summary.highSpendNeedAttentionCount)} 人｜潜力{' '}
              {formatCount(valueRankingData.summary.potentialCustomerCount)} 人
            </p>
          ) : null}
          <p className="mt-1 text-[10px] leading-relaxed text-emerald-900/80">
            说明：真正高价值客户按有效签收、复购、签收率与售后风险综合评分；未签收、售后处理中、已退款不计入有效成交价值。
          </p>
        </div>
      ) : null}

      {isBadBuyerTab ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/40 px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-amber-900">
              按支付时间统计 · 不按主播区分 · 最多展示 10 人
              {badBuyerData?.range ? (
                <span className="ml-1 font-medium">
                  （{badBuyerData.range.presetLabel}：{badBuyerData.range.startDate} 至{' '}
                  {badBuyerData.range.endDate}）
                </span>
              ) : null}
            </p>
            <select
              className="min-h-[40px] rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm text-slate-700"
              value={badBuyerPreset}
              onChange={(e) => {
                setBadBuyerPreset(e.target.value)
                setPage(1)
              }}
              data-testid="bad-buyer-date-preset"
            >
              {BAD_BUYER_PRESET_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {badBuyerPreset === 'custom' ? (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <input
                type="date"
                className="min-h-[40px] w-full rounded-lg border border-amber-200 px-3 py-1.5 text-sm"
                value={badBuyerCustomStart}
                onChange={(e) => setBadBuyerCustomStart(e.target.value)}
              />
              <span className="hidden text-center text-xs text-slate-400 sm:block">至</span>
              <input
                type="date"
                className="min-h-[40px] w-full rounded-lg border border-amber-200 px-3 py-1.5 text-sm"
                value={badBuyerCustomEnd}
                onChange={(e) => setBadBuyerCustomEnd(e.target.value)}
              />
            </div>
          ) : null}
          <p className="mt-2 text-[10px] leading-relaxed text-amber-900/90">
            说明：这个榜单只用于发货前提醒和售前确认，不要在客户面前使用负面话术。风险分不是拉黑依据，重点是帮助客服提前确认细节，减少不必要的售后。
          </p>
        </div>
      ) : null}

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
              !isHighValueTab && profile?.buyerCount === 0
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
            const rowRec = row as Record<string, unknown>
            const rank = isBadBuyerTab || isHighValueTab ? idx + 1 : (page - 1) * pageSize + idx + 1

            if (isHighValueTab) {
              const vp = valueRankingProfileFromRow(rowRec)
              const metrics = valueRankingMetricsFromProfile(vp)
              const displayLabel = buyerDisplayLabel(rowRec)
              const customerTypeLabel = String(vp.customerTypeLabel ?? '—')
              const scoreText = String(vp.highValueScoreText ?? '')
              const validOrderCount = Number(metrics.validOrderCount ?? 0)
              const signedAmountCent = Number(metrics.signedAmountCent ?? 0)
              const paidCount = Number(metrics.paidOrderCount ?? 0)
              const signedCountRaw = metrics.signedOrderCount
              const signedCount =
                signedCountRaw == null ? null : Number(signedCountRaw ?? 0)
              const signedRateLabel =
                metrics.signedRate == null || paidCount <= 0
                  ? '—'
                  : `${Math.round(Number(metrics.signedRate) * 100)}%`
              const refundRateLabel = `${Math.round(Math.min(Number(metrics.refundRate ?? 0), 1) * 100)}%`
              const avgValidCent = Number(metrics.avgValidAmountCent ?? 0)
              const lastPay = String(metrics.lastPayTime ?? rowRec.lastOrderTime ?? '—')
              const shopLabel = String(vp.shopLabel ?? '未知店铺')
              const reasons = Array.isArray(vp.reasons) ? (vp.reasons as string[]).join('、') : '—'
              const suggestions = Array.isArray(vp.suggestions)
                ? (vp.suggestions as string[]).join('；')
                : String(vp.suggestions ?? '—')
              return (
                <article
                  key={`highValue-${String(rowRec.buyerKey ?? rowRec.buyerId)}`}
                  role="button"
                  tabIndex={0}
                  style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
                  className="board-list-row-enter flex cursor-pointer flex-col gap-2 rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-white p-3 shadow-sm transition active:bg-emerald-100/40 sm:p-4 sm:hover:-translate-y-0.5 sm:hover:shadow-md"
                  onClick={() => {
                    setOrderDrawerScope(null)
                    setOrderDrawerBuyer(rowToDrawerBuyer(rowRec))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setOrderDrawerScope(null)
                      setOrderDrawerBuyer(rowToDrawerBuyer(rowRec))
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-semibold leading-snug text-slate-900">{displayLabel}</p>
                    <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      #{rank}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-emerald-800">
                    客户类型：{customerTypeLabel}｜高价值分：{scoreText}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    有效签收：{signedCount == null ? '—' : `${formatCount(signedCount)} 单`}｜有效签收金额：
                    {formatMoney(signedAmountCent / 100)}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    支付：{formatCount(paidCount)} 单｜签收率：{signedRateLabel}｜退款率：{refundRateLabel}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    客单价：{formatMoney(avgValidCent / 100)}｜最近成交：{lastPay}
                  </p>
                  <p className="truncate text-[11px] text-slate-600">店铺：{shopLabel}</p>
                  <p className="text-[11px] text-emerald-900">原因：{reasons}</p>
                  <p className="text-[10px] text-slate-600">建议：{suggestions}</p>
                  <div className="mt-1 flex justify-end border-t border-emerald-100 pt-2 text-[11px] text-emerald-700">
                    查看这个买家的订单 →
                  </div>
                </article>
              )
            }

            if (isBadBuyerTab) {
              const bp = badBuyerProfileFromRow(rowRec)
              const displayLabel = buyerDisplayLabel(rowRec)
              const riskLevel = String(bp.riskLevel ?? '关注')
              const riskScoreText = String(bp.riskScoreText ?? '')
              const paidCount = Number(bp.paidCount ?? rowRec.orderCount ?? 0)
              const signedCountRaw = bp.signedCount
              const signedCount =
                signedCountRaw == null ? null : Number(signedCountRaw ?? rowRec.signedOrderCount ?? 0)
              const signedLine =
                signedCount == null ? '—' : `${formatCount(signedCount)} 单`
              const signedRateLabel =
                signedCount == null || paidCount <= 0
                  ? '—'
                  : `${Math.round((Number(bp.signedRate ?? signedCount / paidCount) || 0) * 100)}%`
              const refundOrderCount = Number(bp.refundOrderCount ?? 0)
              const refundRate = Number(bp.refundRate ?? 0)
              const refundRateLabel = `${Math.round(Math.min(refundRate, 1) * 100)}%`
              const refundAmount = Number(bp.refundAmountYuan ?? 0)
              const qc = Number(bp.qualityRefundOrderCount ?? 0)
              const rr = Number(bp.returnRefundOrderCount ?? 0)
              const aftersaleCount = Number(bp.aftersaleCount ?? bp.afterSaleOrderCount ?? 0)
              const shopLabel = String(bp.shopLabel ?? bp.mainShopName ?? '未知店铺')
              const reasonText = String(bp.reasonText ?? '—')
              const suggestionText = String(bp.suggestionText ?? '—')
              const range = badBuyerData?.range
              const openDrawer = () => {
                setOrderDrawerScope(
                  range
                    ? {
                        startDate: range.startDate,
                        endDate: range.endDate,
                        source: 'bad_buyer_ranking',
                      }
                    : null,
                )
                setOrderDrawerBuyer(rowToDrawerBuyer(rowRec))
              }
              return (
                <article
                  key={`badBuyer-${String(rowRec.buyerKey ?? rowRec.buyerId)}`}
                  role="button"
                  tabIndex={0}
                  style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
                  className="board-list-row-enter flex cursor-pointer flex-col gap-2 rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50/80 to-red-50/30 p-3 shadow-sm transition active:bg-amber-100/40 sm:p-4 sm:hover:-translate-y-0.5 sm:hover:shadow-md"
                  onClick={openDrawer}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openDrawer()
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-semibold leading-snug text-slate-900">
                      {displayLabel}
                    </p>
                    <span className="shrink-0 rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      #{rank}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-red-700">
                    风险等级：{riskLevel}｜风险分：{riskScoreText}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    支付：{formatCount(paidCount)} 单｜签收：{signedLine}｜签收率：{signedRateLabel}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    退款：{formatCount(refundOrderCount)} 单｜退款率：{refundRateLabel}｜退款金额：
                    {formatMoney(refundAmount)}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    品退：{formatCount(qc)} 单｜退货退款：{formatCount(rr)} 单｜售后申请：
                    {formatCount(aftersaleCount)} 次
                  </p>
                  <p className="truncate text-[11px] text-slate-600">店铺：{shopLabel}</p>
                  <p className="text-[11px] text-amber-900">原因：{reasonText}</p>
                  <p className="text-[10px] text-slate-600">建议：{suggestionText}</p>
                  <div className="mt-1 flex justify-end border-t border-amber-100 pt-2 text-[11px] text-amber-700">
                    查看这个买家的订单 →
                  </div>
                </article>
              )
            }

            const vp = valueProfileFromRow(rowRec)
            const mainTag = String(vp.mainTag ?? '').trim()
            const displayLabel = buyerDisplayLabel(rowRec)
            const earnedAmount = buyerCardEarnedAmount(rowRec)
            const signedCount = Number(vp.signedOrderCount ?? rowRec.signedOrderCount ?? 0)
            const scoreText = String(vp.scoreText ?? '')
            const completedCount = Number(vp.completedOrderCount ?? rowRec.completedOrderCount ?? 0)
            const afterSaleCount = Number(vp.afterSaleOrderCount ?? rowRec.afterSaleCount ?? 0)
            const averageOrderValue = Number(vp.averageOrderValueYuan ?? 0)
            const shopLabel = String(rowRec.shopLabel ?? vp.shopLabel ?? rowRec.mainShopName ?? '未知店铺')
            const suggestion = String(vp.suggestion ?? rowRec.suggestion ?? '—')
            return (
              <article
                key={`${rankingTab}-${String(rowRec.buyerKey ?? rowRec.buyerId)}`}
                role="button"
                tabIndex={0}
                style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
                className="board-list-row-enter flex cursor-pointer flex-col gap-2 rounded-2xl border border-rose-100/50 bg-white p-3 shadow-sm transition active:bg-rose-50/30 sm:p-4 sm:hover:-translate-y-0.5 sm:hover:shadow-md"
                onClick={() => {
                  setOrderDrawerScope(null)
                  setOrderDrawerBuyer(rowToDrawerBuyer(rowRec))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setOrderDrawerScope(null)
                    setOrderDrawerBuyer(rowToDrawerBuyer(rowRec))
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-semibold leading-snug text-slate-900">{displayLabel}</p>
                  <span className="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    #{rank}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {mainTag ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TAG_COLORS[mainTag] ?? 'bg-slate-100 text-slate-700'}`}
                    >
                      {mainTag}
                    </span>
                  ) : null}
                  {scoreText ? (
                    <span className="text-[11px] font-semibold text-emerald-700">价值分 {scoreText}</span>
                  ) : null}
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">累计成交</p>
                  <p className="text-xl font-bold tabular-nums text-rose-900">{formatMoney(earnedAmount)}</p>
                </div>
                <p className="text-[11px] text-slate-600">
                  签收 {formatCount(signedCount)} 单｜完成 {formatCount(completedCount)} 单｜售后{' '}
                  {formatCount(afterSaleCount)} 单
                </p>
                <p className="text-[11px] text-slate-600">
                  平均客单价 {formatMoney(averageOrderValue)}
                </p>
                <p className="truncate text-[11px] text-slate-600">店铺：{shopLabel}</p>
                <p className="text-[10px] text-slate-500">建议：{suggestion}</p>
                <div className="mt-1 flex justify-end border-t border-rose-50 pt-2 text-[11px] text-rose-600">
                  查看这个买家的订单 →
                </div>
              </article>
            )
          })
        )}
      </div>
      </MetricGridTransition>
      {total > 0 && !isBadBuyerTab && !isHighValueTab && (
        <Pagination page={page} total={total} pageSize={pageSize} onPage={setPage} />
      )}
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
        onClose={() => {
          setOrderDrawerBuyer(null)
          setOrderDrawerScope(null)
        }}
        buyer={orderDrawerBuyer}
        scope={orderDrawerScope ?? undefined}
      />
      <ViewportModal
        open={wechatModalText != null}
        onClose={() => setWechatModalText(null)}
        panelClassName="max-h-[min(88dvh,calc(100dvh-1rem))] w-[min(640px,calc(100vw-1rem))]"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 id="wechat-ranking-modal-title" className="text-sm font-semibold text-slate-900">
            微信群榜单文案
          </h3>
          <button
            type="button"
            className="min-h-[44px] min-w-[44px] text-sm text-slate-500"
            onClick={() => setWechatModalText(null)}
          >
            关闭
          </button>
        </div>
        <textarea
          ref={wechatTextareaRef}
          aria-labelledby="wechat-ranking-modal-title"
          className="min-h-[50dvh] flex-1 resize-none overflow-y-auto border-0 p-4 text-sm leading-relaxed text-slate-800 focus:outline-none focus:ring-0 sm:min-h-[320px]"
          value={wechatModalText ?? ''}
          onChange={(e) => setWechatModalText(e.target.value)}
        />
        <div className="flex gap-2 border-t border-slate-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            className="min-h-[44px] flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700"
            onClick={() => setWechatModalText(null)}
          >
            关闭
          </button>
          <button
            type="button"
            className="min-h-[44px] flex-[2] rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white active:bg-emerald-800"
            onClick={() => void handleWechatModalCopy()}
            data-testid="wechat-modal-copy"
          >
            一键复制
          </button>
        </div>
      </ViewportModal>
      <FloatingToast message={wechatToast} className="bg-emerald-700 text-white" />
    </div>
  )
}

