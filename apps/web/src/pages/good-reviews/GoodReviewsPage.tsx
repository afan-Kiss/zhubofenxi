import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Star, ThumbsUp } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import {
  formatGoodReviewSyncMessage,
  formatLocalDateTime,
  formatMoneyFromCent,
  type GoodReviewItemView,
  type GoodReviewPagePayload,
  type GoodReviewShopView,
  type GoodReviewSyncResult,
} from '../../lib/good-reviews'
import { GoodReviewOrderRow } from '../../components/good-reviews/GoodReviewOrderRow'
import { GoodReviewDetailDrawer } from '../../components/good-reviews/GoodReviewDetailDrawer'

const SHOP_TAB_ORDER = ['shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu']

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
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
        {review.itemImage ? (
          <img
            src={review.itemImage}
            alt={review.itemName ?? '商品图'}
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
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
            {shopName ? <span>{shopName}</span> : null}
            {price ? <span>{price}</span> : null}
            {review.productScore != null ? <span>商品 {review.productScore} 分</span> : null}
            {review.serviceScore != null ? <span>服务 {review.serviceScore} 分</span> : null}
            {review.logisticsScore != null ? <span>物流 {review.logisticsScore} 分</span> : null}
          </div>
          {review.reviewText ? (
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{review.reviewText}</p>
          ) : (
            <p className="mt-2 text-sm text-slate-400">买家未填写文字评价</p>
          )}
          {review.reviewImages.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {review.reviewImages.slice(0, 4).map((url) => (
                <img
                  key={url}
                  src={url}
                  alt="买家晒图"
                  className="h-16 w-16 rounded-lg object-cover"
                />
              ))}
            </div>
          ) : null}
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
  const [payload, setPayload] = useState<GoodReviewPagePayload | null>(null)
  const [activeShop, setActiveShop] = useState(SHOP_TAB_ORDER[0]!)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [banner, setBanner] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [detailReview, setDetailReview] = useState<GoodReviewItemView | null>(null)

  const shopNameByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const shop of payload?.shops ?? []) {
      map.set(shop.shopKey, shop.shopName)
    }
    return map
  }, [payload?.shops])

  const loadLocal = useCallback(async (shopKey?: string) => {
    const shop = shopKey ?? activeShop
    const data = await apiRequest<GoodReviewPagePayload>(
      `/api/good-reviews?shop=${encodeURIComponent(shop)}&limit=200`,
    )
    setPayload(data)
    return data
  }, [activeShop])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError('')
      try {
        await loadLocal(activeShop)
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取本地好评数据失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [activeShop, loadLocal])

  const activeShopView = useMemo<GoodReviewShopView | null>(() => {
    if (!payload) return null
    return payload.shops.find((s) => s.shopKey === activeShop) ?? payload.shops[0] ?? null
  }, [payload, activeShop])

  const handleRefreshLocal = async () => {
    setRefreshing(true)
    setError('')
    setBanner(null)
    try {
      await loadLocal(activeShop)
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新本地数据失败')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSyncAll = async () => {
    setSyncing(true)
    setError('')
    setBanner(null)
    try {
      const result = await apiRequest<GoodReviewSyncResult>('/api/good-reviews/sync', {
        method: 'POST',
        body: JSON.stringify({ shop: 'all' }),
      })
      setBanner(formatGoodReviewSyncMessage(result))
      await loadLocal(activeShop)
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败')
      setBanner({
        tone: 'error',
        text: '同步失败：四个店铺都没有同步成功，请检查 Cookie 或接口状态',
      })
    } finally {
      setSyncing(false)
    }
  }

  const lastSyncedLabel = formatLocalDateTime(payload?.lastSyncedAt)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="space-y-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-semibold text-slate-900">好评中心</h1>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefreshLocal()}
              disabled={loading || refreshing || syncing}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              刷新页面数据
            </button>
            <button
              type="button"
              onClick={() => void handleSyncAll()}
              disabled={loading || refreshing || syncing}
              data-testid="good-reviews-sync-all"
              className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <ThumbsUp size={14} />}
              {syncing ? '正在同步四个店铺...' : '立即同步全部店铺好评'}
            </button>
          </div>
        </div>
        <p className="max-w-3xl text-sm text-slate-500">
          查看四个店铺的评分、买家晒图和真实评价内容，用来判断店铺口碑，也方便挑选直播间能用的信任素材。
        </p>
        <p className="text-sm text-slate-600">
          {lastSyncedLabel
            ? `最后同步：${lastSyncedLabel}`
            : '还没有同步过，点击右上角按钮获取最新好评'}
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
        {(payload?.shops ?? [])
          .slice()
          .sort(
            (a, b) =>
              SHOP_TAB_ORDER.indexOf(a.shopKey) - SHOP_TAB_ORDER.indexOf(b.shopKey),
          )
          .map((shop) => (
            <button
              key={shop.shopKey}
              type="button"
              data-testid={`good-reviews-tab-${shop.shopKey}`}
              onClick={() => setActiveShop(shop.shopKey)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeShop === shop.shopKey
                  ? 'bg-white text-slate-900 shadow-md ring-2 ring-rose-100'
                  : 'bg-white/60 text-slate-600 hover:bg-white'
              }`}
            >
              {shop.shopName}
            </button>
          ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-8 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          正在读取本地好评数据...
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
              <StatCard label="评价总数" value={activeShopView.totalReviewCount} />
              <StatCard label="有图评价" value={activeShopView.withImageCount} />
              <StatCard label="有文字评价" value={activeShopView.withTextCount} />
              <StatCard label="未回复" value={activeShopView.unrepliedCount} />
              <StatCard label="已回复" value={activeShopView.repliedCount} />
              <StatCard label="待互动好评" value={activeShopView.pendingInteractionCount} />
              <StatCard label="待处理差评" value={activeShopView.pendingBadReviewCount} />
              <StatCard
                label="本页展示"
                value={payload?.reviews.length ?? 0}
              />
            </div>
          </div>

          <div className="space-y-3">
            {(payload?.reviews ?? []).length > 0 ? (
              payload!.reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  shopName={shopNameByKey.get(review.shopKey)}
                  onOpen={setDetailReview}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-10 text-center text-sm text-slate-500">
                当前店铺还没有本地好评数据，可点击右上角「立即同步全部店铺好评」获取最新内容。
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
      />
    </div>
  )
}
