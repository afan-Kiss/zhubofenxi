import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Star, ThumbsUp } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import {
  buildGoodReviewsListUrl,
  DEFAULT_GOOD_REVIEW_LIST_FILTERS,
  describeGoodReviewFilters,
  formatGoodReviewSyncMessage,
  formatGoodReviewBuyerLabel,
  formatLocalDateTime,
  formatMoneyFromCent,
  GOOD_REVIEWS_DEFAULT_DAYS,
  GOOD_REVIEWS_PAGE_LIMIT,
  GOOD_REVIEW_SHOP_SYNC_ORDER,
  GOOD_REVIEW_UI_VERSION,
  getGoodReviewShopTabIndex,
  mergeGoodReviewSyncResults,
  resolveGoodReviewThumb,
  type GoodReviewItemView,
  type GoodReviewListFilters,
  type GoodReviewPagePayload,
  type GoodReviewShopKey,
  type GoodReviewShopView,
  type GoodReviewSyncResult,
} from '../../lib/good-reviews'
import { GoodReviewOrderRow } from '../../components/good-reviews/GoodReviewOrderRow'
import { GoodReviewDetailDrawer } from '../../components/good-reviews/GoodReviewDetailDrawer'
import { GoodReviewFiltersBar } from '../../components/good-reviews/GoodReviewFiltersBar'
import { GoodReviewCopyScriptButton } from '../../components/good-reviews/GoodReviewCopyScriptButton'
import { GoodReviewSyncProgressButton } from '../../components/good-reviews/GoodReviewSyncProgressButton'
import {
  GoodReviewImage,
  closeGoodReviewImageSessionBeacon,
  ensureGoodReviewImageSession,
} from '../../components/good-reviews/GoodReviewImage'

const SHOP_TAB_ORDER = [...GOOD_REVIEW_SHOP_SYNC_ORDER]

function mergeUniqueReviews(
  prev: GoodReviewItemView[],
  next: GoodReviewItemView[],
): GoodReviewItemView[] {
  const seen = new Set(prev.map((r) => r.id))
  const out = [...prev]
  for (const row of next) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function hasActiveGoodReviewFilters(filters: GoodReviewListFilters): boolean {
  return (
    filters.content !== 'all' ||
    filters.replyStatus !== 'all' ||
    filters.minProductScore !== 'all' ||
    Boolean(filters.materialTag.trim()) ||
    Boolean(filters.itemKeyword.trim()) ||
    Boolean(filters.reviewKeyword.trim())
  )
}

function ReviewCard({
  review,
  shopName,
  onOpen,
}: {
  review: GoodReviewItemView
  shopName?: string | null
  onOpen: (review: GoodReviewItemView) => void
}) {
  const price = formatMoneyFromCent(review.itemPriceCent)
  const timeLabel = review.reviewTimeText ?? formatLocalDateTime(review.reviewTime)
  const thumbUrl = resolveGoodReviewThumb(review)
  const thumbFromReview = !review.itemImage && Boolean(review.reviewImages?.[0])
  return (
    <article
      className="cursor-pointer rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition hover:border-rose-100 hover:shadow-md"
      onClick={() => onOpen(review)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(review)
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex gap-3">
        {thumbUrl ? (
          <GoodReviewImage
            rawUrl={thumbUrl}
            alt={thumbFromReview ? '买家晒图' : (review.itemName ?? '商品图')}
            className="h-16 w-16 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[11px] text-slate-400">
            无图
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">
            {review.itemName ?? '未命名商品'}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-slate-700">
            买家：{formatGoodReviewBuyerLabel(review)}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
            {shopName ? <span>{shopName}</span> : null}
            {price ? <span>{price}</span> : null}
            {review.productScore != null ? <span>商品 {review.productScore} 分</span> : null}
            {review.serviceScore != null ? <span>服务 {review.serviceScore} 分</span> : null}
            {review.logisticsScore != null ? <span>物流 {review.logisticsScore} 分</span> : null}
          </div>
          {review.reviewImages.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {review.reviewImages.slice(0, 4).map((url) => (
                <GoodReviewImage
                  key={url}
                  rawUrl={url}
                  alt="买家晒图"
                  className="h-16 w-16 rounded-lg object-cover"
                />
              ))}
            </div>
          ) : null}
          {(review.materialTags?.length ?? 0) > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {review.materialTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <div
            className="mt-2 flex flex-wrap items-center gap-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <GoodReviewCopyScriptButton
              review={review}
              shopName={shopName ?? review.shopKey}
              compact
            />
          </div>
          <div
            className="mt-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <GoodReviewOrderRow orderId={review.orderId} shopKey={review.shopKey} compact />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            {timeLabel ? <span>{timeLabel}</span> : null}
            <span>点赞 {review.likeCount}</span>
            <span>回复 {review.replyCount}</span>
            {review.isAnonymous ? <span>匿名评价</span> : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export const GoodReviewsPage: React.FC = () => {
  const [shops, setShops] = useState<GoodReviewShopView[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [filteredReviewCount, setFilteredReviewCount] = useState(0)
  const [totalReviewCount, setTotalReviewCount] = useState(0)
  const [reviews, setReviews] = useState<GoodReviewItemView[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [activeShop, setActiveShop] = useState<GoodReviewShopKey>(SHOP_TAB_ORDER[0]!)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncAllProgress, setSyncAllProgress] = useState(0)
  const [syncAllLabel, setSyncAllLabel] = useState('')
  const [banner, setBanner] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [detailReview, setDetailReview] = useState<GoodReviewItemView | null>(null)
  const [filters, setFilters] = useState<GoodReviewListFilters>(DEFAULT_GOOD_REVIEW_LIST_FILTERS)
  const [queryFilters, setQueryFilters] = useState<GoodReviewListFilters>(
    DEFAULT_GOOD_REVIEW_LIST_FILTERS,
  )

  const abortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const inFlightCursorRef = useRef<string | null>(null)
  const queryFiltersRef = useRef(queryFilters)
  const mountedRef = useRef(true)

  queryFiltersRef.current = queryFilters

  useEffect(() => {
    mountedRef.current = true
    ensureGoodReviewImageSession()
    const onClose = () => closeGoodReviewImageSessionBeacon()
    window.addEventListener('pagehide', onClose)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', onClose)
      onClose()
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const delay =
      filters.itemKeyword.trim() || filters.reviewKeyword.trim() ? 400 : 0
    const t = window.setTimeout(() => {
      setQueryFilters({ ...filters })
    }, delay)
    return () => window.clearTimeout(t)
  }, [filters])

  const handleReviewUpdated = useCallback((updated: GoodReviewItemView) => {
    setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    setDetailReview((prev) => (prev?.id === updated.id ? updated : prev))
  }, [])

  const shopNameByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const shop of shops) {
      map.set(shop.shopKey, shop.shopName)
    }
    return map
  }, [shops])

  const applyPayload = useCallback((data: GoodReviewPagePayload, append: boolean) => {
    setShops(data.shops)
    setLastSyncedAt(data.lastSyncedAt)
    setFilteredReviewCount(data.filteredReviewCount ?? data.reviews.length)
    setTotalReviewCount(data.totalReviewCount ?? 0)
    setReviews((prev) => (append ? mergeUniqueReviews(prev, data.reviews) : data.reviews))
    setNextCursor(data.nextCursor ?? null)
    setHasMore(Boolean(data.hasMore))
  }, [])

  const fetchPage = useCallback(
    async (params: {
      shop: string
      cursor?: string | null
      append?: boolean
      signal?: AbortSignal
    }): Promise<GoodReviewPagePayload | null> => {
      const seq = ++requestSeqRef.current
      const url = buildGoodReviewsListUrl({
        shop: params.shop,
        days: GOOD_REVIEWS_DEFAULT_DAYS,
        limit: GOOD_REVIEWS_PAGE_LIMIT,
        cursor: params.cursor,
        filters: queryFiltersRef.current,
      })
      try {
        const data = await apiRequest<GoodReviewPagePayload>(url, { signal: params.signal })
        if (seq !== requestSeqRef.current || !mountedRef.current) return null
        applyPayload(data, Boolean(params.append))
        return data
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return null
        if (seq !== requestSeqRef.current || !mountedRef.current) return null
        throw err
      }
    },
    [applyPayload],
  )

  const loadFirstPage = useCallback(
    async (shopKey: string, opts?: { silent?: boolean }) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      loadingMoreRef.current = false
      inFlightCursorRef.current = null
      if (!opts?.silent) {
        setReviews([])
        setNextCursor(null)
        setHasMore(false)
        setInitialLoading(true)
      }
      setError('')
      try {
        await fetchPage({ shop: shopKey, signal: controller.signal })
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取最近 3 天好评失败，请稍后重试')
      } finally {
        if (mountedRef.current) setInitialLoading(false)
      }
    },
    [fetchPage],
  )

  const handleReloadList = async () => {
    setRefreshing(true)
    setError('')
    setBanner(null)
    try {
      await loadFirstPage(activeShop)
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新读取列表失败')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadFirstPage(activeShop)
  }, [activeShop, queryFilters, loadFirstPage])

  const loadMorePage = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !nextCursor) return
    if (inFlightCursorRef.current === nextCursor) return

    const cursorToLoad = nextCursor
    loadingMoreRef.current = true
    inFlightCursorRef.current = cursorToLoad
    setLoadingMore(true)
    setError('')
    try {
      await fetchPage({
        shop: activeShop,
        cursor: cursorToLoad,
        append: true,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更多好评失败')
    } finally {
      loadingMoreRef.current = false
      inFlightCursorRef.current = null
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [activeShop, fetchPage, hasMore, nextCursor])

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !hasMore || initialLoading) return

    let disposed = false
    const triggerLoad = () => {
      if (disposed) return
      void loadMorePage()
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) triggerLoad()
      },
      { rootMargin: '240px' },
    )
    observer.observe(el)

    const probeVisible = () => {
      if (disposed || loadingMoreRef.current) return
      const rect = el.getBoundingClientRect()
      if (rect.top <= window.innerHeight + 240) triggerLoad()
    }
    requestAnimationFrame(probeVisible)

    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [hasMore, initialLoading, loadMorePage, reviews.length])

  const activeShopView = useMemo<GoodReviewShopView | null>(() => {
    return shops.find((s) => s.shopKey === activeShop) ?? shops[0] ?? null
  }, [shops, activeShop])

  const handleSyncAll = async () => {
    setSyncing(true)
    setSyncAllProgress(0)
    setSyncAllLabel('准备同步全部店铺...')
    setError('')
    setBanner(null)
    const startedAt = new Date().toISOString()
    const shopResults: GoodReviewSyncResult['shops'] = []
    const total = SHOP_TAB_ORDER.length
    for (let i = 0; i < total; i++) {
      const shopKey = SHOP_TAB_ORDER[i]!
      const shopName = shopNameByKey.get(shopKey) ?? shopKey
      const basePct = Math.round((i / total) * 100)
      setSyncAllProgress(basePct)
      setSyncAllLabel(`正在同步 ${shopName}（${i + 1}/${total}）...`)
      try {
        const result = await apiRequest<GoodReviewSyncResult>('/api/good-reviews/sync', {
          method: 'POST',
          body: JSON.stringify({ shop: shopKey, days: GOOD_REVIEWS_DEFAULT_DAYS }),
        })
        shopResults.push(...result.shops)
      } catch (err) {
        shopResults.push({
          shopKey,
          shopName,
          success: false,
          error: err instanceof Error ? err.message : '同步失败',
        })
      }
      setSyncAllProgress(Math.round(((i + 1) / total) * 100))
    }
    const merged = mergeGoodReviewSyncResults(shopResults, startedAt)
    setSyncAllProgress(100)
    setSyncAllLabel(
      merged.successShopCount === merged.totalShopCount
        ? '全部店铺同步完成'
        : merged.successShopCount > 0
          ? `同步完成：成功 ${merged.successShopCount} 个，失败 ${merged.failedShopCount} 个`
          : '全部店铺同步失败',
    )
    setBanner(formatGoodReviewSyncMessage(merged))
    try {
      await loadFirstPage(activeShop, { silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新列表失败')
    } finally {
      setSyncing(false)
      window.setTimeout(() => {
        setSyncAllProgress(0)
        setSyncAllLabel('')
      }, 600)
    }
  }

  const lastSyncedLabel = formatLocalDateTime(lastSyncedAt)
  const refreshBusy = refreshing
  const busy = initialLoading || refreshBusy || syncing
  const filterStatusParts = describeGoodReviewFilters(queryFilters)
  const filterActive = hasActiveGoodReviewFilters(queryFilters)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="space-y-2">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold text-slate-900">好评中心</h1>
            <span className="text-[10px] text-slate-400" data-testid="good-reviews-ui-version">
              好评中心版本：{GOOD_REVIEW_UI_VERSION}
            </span>
          </div>
          <div
            className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50/80 to-white p-3 shadow-sm"
            data-testid="good-reviews-sync-bar"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <GoodReviewSyncProgressButton
                variant="secondary"
                testId="good-reviews-refresh"
                disabled={busy && !refreshBusy}
                busy={refreshBusy}
                progress={refreshBusy ? 60 : 0}
                idleLabel="重新读取本地列表"
                busyLabel="正在重新读取本地列表..."
                idleIcon={<RefreshCw size={14} />}
                onClick={() => void handleReloadList()}
              />
              <GoodReviewSyncProgressButton
                variant="primary"
                testId="good-reviews-sync-all-visible"
                disabled={busy && !syncing}
                busy={syncing}
                progress={syncAllProgress}
                idleLabel="同步全部店铺好评"
                busyLabel={syncAllLabel || '正在同步全部店铺好评...'}
                idleIcon={<ThumbsUp size={14} />}
                onClick={() => void handleSyncAll()}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              打开页面先读本地缓存；需要拉平台最新数据时，再点「同步全部店铺好评」。
            </p>
          </div>
        </div>
        <p className="max-w-3xl text-sm text-slate-500">
          默认先展示最近 3 天好评；继续下滑会自动加载更早的本地好评，无需手动刷新。
        </p>
        <p className="text-sm text-slate-600">
          {lastSyncedLabel ? `最后同步：${lastSyncedLabel}` : '还没有同步过，可先查看本地已有好评'}
        </p>
      </div>

      {banner ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            banner.tone === 'success'
              ? 'border border-emerald-100 bg-emerald-50 text-emerald-800'
              : banner.tone === 'warning'
                ? 'border border-amber-100 bg-amber-50 text-amber-900'
                : 'border border-rose-100 bg-rose-50 text-rose-800'
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(shops.length > 0 ? shops : SHOP_TAB_ORDER.map((k) => ({ shopKey: k, shopName: k })))
          .slice()
          .sort(
            (a, b) =>
              getGoodReviewShopTabIndex(a.shopKey) - getGoodReviewShopTabIndex(b.shopKey),
          )
          .map((shop) => (
            <button
              key={shop.shopKey}
              type="button"
              data-testid={`good-reviews-tab-${shop.shopKey}`}
              onClick={() => {
                const idx = getGoodReviewShopTabIndex(shop.shopKey)
                if (idx >= 0) setActiveShop(GOOD_REVIEW_SHOP_SYNC_ORDER[idx]!)
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeShop === shop.shopKey
                  ? 'bg-white text-slate-900 shadow-md ring-2 ring-rose-100'
                  : 'bg-white/60 text-slate-600 hover:bg-white'
              }`}
            >
              {'shopName' in shop && shop.shopName ? shop.shopName : shop.shopKey}
            </button>
          ))}
      </div>

      <GoodReviewFiltersBar filters={filters} onChange={setFilters} />

      {!initialLoading ? (
        <p className="text-xs text-slate-500">
          {filterStatusParts.join(' · ')} · 已展示 {reviews.length}
          {filteredReviewCount > 0 ? ` · 最近 3 天 ${filteredReviewCount} 条` : ''}
          {totalReviewCount > filteredReviewCount ? ` · 店铺累计 ${totalReviewCount} 条` : ''}
        </p>
      ) : null}

      {initialLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-8 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          正在读取最近 3 天好评...
        </div>
      ) : activeShopView ? (
        <>
          <div className="grid gap-3 md:grid-cols-[180px_1fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Star size={16} className="text-amber-400" />
                店铺评分
              </div>
              <div className="mt-2 text-3xl font-semibold text-slate-900">
                {activeShopView.shopScore != null ? activeShopView.shopScore.toFixed(2) : '—'}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                好评 {activeShopView.goodReviewCount} · 中评 {activeShopView.mediumReviewCount} · 差评{' '}
                {activeShopView.badReviewCount}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatCard label="累计评价总数" value={activeShopView.totalReviewCount} />
              <StatCard label="累计有图评价" value={activeShopView.withImageCount} />
              <StatCard label="累计有文字评价" value={activeShopView.withTextCount} />
              <StatCard label="累计未回复" value={activeShopView.unrepliedCount} />
              <StatCard label="累计已回复" value={activeShopView.repliedCount} />
              <StatCard label="当前待互动好评" value={activeShopView.pendingInteractionCount} />
              <StatCard label="当前待处理差评" value={activeShopView.pendingBadReviewCount} />
              <StatCard label="最近 3 天" value={filteredReviewCount} />
            </div>
          </div>

          <div className="space-y-3">
            {reviews.length > 0 ? (
              <>
                {reviews.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    shopName={shopNameByKey.get(review.shopKey)}
                    onOpen={setDetailReview}
                  />
                ))}
                <div ref={loadMoreRef} className="space-y-2 py-2">
                  {hasMore ? (
                    <button
                      type="button"
                      data-testid="good-reviews-load-more"
                      disabled={loadingMore}
                      onClick={() => void loadMorePage()}
                      className="mx-auto flex w-full max-w-sm items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white px-4 py-2.5 text-sm font-medium text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          正在加载更多...
                        </>
                      ) : (
                        '加载更多好评'
                      )}
                    </button>
                  ) : (
                    <p className="text-center text-xs text-slate-400">已加载全部本地好评</p>
                  )}
                  {hasMore && !loadingMore ? (
                    <p className="text-center text-[11px] text-slate-400">继续下滑也会自动加载</p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-10 text-center text-sm text-slate-500">
                {filterActive
                  ? '最近 3 天没有找到符合条件的好评，可以放宽筛选条件试试。'
                  : '当前店铺最近 3 天还没有本地好评；继续下滑可查看更早记录，或点「同步全部店铺好评」拉取最新数据。'}
              </div>
            )}
          </div>
        </>
      ) : null}

      <GoodReviewDetailDrawer
        open={detailReview !== null}
        review={detailReview}
        shopName={detailReview ? shopNameByKey.get(detailReview.shopKey) : null}
        onClose={() => setDetailReview(null)}
        onReviewUpdated={handleReviewUpdated}
      />

      <p className="pb-4 text-center text-[10px] text-slate-400">
        好评中心版本：{GOOD_REVIEW_UI_VERSION}
      </p>
    </div>
  )
}
