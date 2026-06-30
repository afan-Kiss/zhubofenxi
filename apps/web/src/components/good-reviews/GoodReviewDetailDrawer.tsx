import React from 'react'
import { BoardDrawerShell } from '../board/BoardDrawerShell'
import {
  formatLocalDateTime,
  formatMoneyFromCent,
  type GoodReviewItemView,
} from '../../lib/good-reviews'
import { GoodReviewOrderRow } from './GoodReviewOrderRow'

interface Props {
  open: boolean
  review: GoodReviewItemView | null
  shopName?: string | null
  onClose: () => void
}

export const GoodReviewDetailDrawer: React.FC<Props> = ({
  open,
  review,
  shopName,
  onClose,
}) => {
  if (!review) return null

  const price = formatMoneyFromCent(review.itemPriceCent)
  const timeLabel = review.reviewTimeText ?? formatLocalDateTime(review.reviewTime)

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={review.itemName ?? '评价详情'}
      subtitle={shopName ? `${shopName} · 评价明细` : '评价明细'}
      testId="good-review-detail-drawer"
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          {review.itemImage ? (
            <img
              src={review.itemImage}
              alt={review.itemName ?? '商品图'}
              className="h-20 w-20 shrink-0 rounded-xl object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-1 text-sm text-slate-600">
            {price ? <div>商品价格：{price}</div> : null}
            {review.productScore != null ? <div>商品评分：{review.productScore}</div> : null}
            {review.serviceScore != null ? <div>服务评分：{review.serviceScore}</div> : null}
            {review.logisticsScore != null ? <div>物流评分：{review.logisticsScore}</div> : null}
            {timeLabel ? <div>评价时间：{timeLabel}</div> : null}
          </div>
        </div>

        <GoodReviewOrderRow orderId={review.orderId} shopKey={review.shopKey} />

        {review.reviewText ? (
          <div className="rounded-2xl border border-slate-100 bg-white p-3 text-sm leading-relaxed text-slate-700">
            {review.reviewText}
          </div>
        ) : (
          <div className="text-sm text-slate-400">买家未填写文字评价</div>
        )}

        {review.reviewImages.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {review.reviewImages.map((url) => (
              <img
                key={url}
                src={url}
                alt="买家晒图"
                className="h-24 w-24 rounded-xl object-cover"
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
