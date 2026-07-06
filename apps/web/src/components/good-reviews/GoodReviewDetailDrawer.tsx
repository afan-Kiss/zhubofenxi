import React from 'react'
import { BoardDrawerShell } from '../board/BoardDrawerShell'
import {
  formatLocalDateTime,
  formatMoneyFromCent,
  resolveGoodReviewThumb,
  type GoodReviewItemView,
} from '../../lib/good-reviews'
import { GoodReviewOrderRow } from './GoodReviewOrderRow'
import { GoodReviewImage, buildGoodReviewImageProxyUrl } from './GoodReviewImage'
import { GoodReviewCopyScriptButton } from './GoodReviewCopyScriptButton'
import { GoodReviewMaterialTagPicker } from './GoodReviewMaterialTagPicker'

interface Props {
  open: boolean
  review: GoodReviewItemView | null
  shopName?: string | null
  onClose: () => void
  onReviewUpdated: (review: GoodReviewItemView) => void
}

export const GoodReviewDetailDrawer: React.FC<Props> = ({
  open,
  review,
  shopName,
  onClose,
  onReviewUpdated,
}) => {
  if (!review) return null

  const price = formatMoneyFromCent(review.itemPriceCent)
  const timeLabel = review.reviewTimeText ?? formatLocalDateTime(review.reviewTime)
  const displayShop = shopName ?? review.shopKey
  const thumbUrl = resolveGoodReviewThumb(review)
  const thumbFromReview = !review.itemImage && Boolean(review.reviewImages?.[0])

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={review.itemName ?? '评价详情'}
      subtitle={displayShop ? `${displayShop} · 评价明细` : '评价明细'}
      testId="good-review-detail-drawer"
    >
      <div className="space-y-4">
        <section
          className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-4 shadow-sm"
          data-testid="good-review-live-material-card"
        >
          <h3 className="text-sm font-semibold text-emerald-900">直播间可用素材</h3>
          <p className="mt-1 text-xs text-emerald-800/80">
            下面这段可以直接复制到直播间介绍，话术来自真实买家反馈。
          </p>
          <dl className="mt-3 space-y-2 text-sm text-slate-700">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-slate-500">商品</dt>
              <dd className="min-w-0 font-medium">{review.itemName ?? '未命名商品'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-slate-500">店铺</dt>
              <dd>{displayShop}</dd>
            </div>
            {timeLabel ? (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-500">时间</dt>
                <dd>{timeLabel}</dd>
              </div>
            ) : null}
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-slate-500">评价</dt>
              <dd className="min-w-0 leading-relaxed">
                {review.reviewText?.trim() || '买家未填写文字，但给了好评'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-slate-500">晒图</dt>
              <dd>{review.reviewImages.length} 张</dd>
            </div>
          </dl>
          <div className="mt-3">
            <GoodReviewMaterialTagPicker
              review={review}
              onUpdated={onReviewUpdated}
            />
          </div>
          <div className="mt-3">
            <GoodReviewCopyScriptButton review={review} shopName={displayShop} />
          </div>
        </section>

        <div className="flex gap-3">
          {thumbUrl ? (
            <GoodReviewImage
              rawUrl={thumbUrl}
              alt={thumbFromReview ? '买家晒图' : (review.itemName ?? '商品图')}
              className="h-20 w-20 shrink-0 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[11px] text-slate-400">
              无图
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1 text-sm text-slate-600">
            {price ? <div>商品价格：{price}</div> : null}
            {review.productScore != null ? <div>商品评分：{review.productScore}</div> : null}
            {review.serviceScore != null ? <div>服务评分：{review.serviceScore}</div> : null}
            {review.logisticsScore != null ? <div>物流评分：{review.logisticsScore}</div> : null}
          </div>
        </div>

        <GoodReviewOrderRow orderId={review.orderId} shopKey={review.shopKey} />

        {review.reviewImages.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {review.reviewImages.map((url) => (
              <GoodReviewImage
                key={url}
                rawUrl={url}
                alt="买家晒图"
                className="h-24 w-24 rounded-xl object-cover"
                onClick={() =>
                  window.open(buildGoodReviewImageProxyUrl(url), '_blank', 'noopener,noreferrer')
                }
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          <span>点赞 {review.likeCount}</span>
          <span>回复 {review.replyCount}</span>
          {review.isAnonymous ? <span>匿名评价</span> : null}
          {review.reviewId ? <span>评价 ID：{review.reviewId}</span> : null}
        </div>
      </div>
    </BoardDrawerShell>
  )
}
