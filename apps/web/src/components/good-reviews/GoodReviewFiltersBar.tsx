import React from 'react'
import type {
  GoodReviewContentFilter,
  GoodReviewListFilters,
  GoodReviewMinScoreFilter,
  GoodReviewReplyFilter,
} from '../../lib/good-reviews'
import { GOOD_REVIEW_MATERIAL_TAG_OPTIONS } from '../../lib/good-reviews'

interface Props {
  filters: GoodReviewListFilters
  onChange: (next: GoodReviewListFilters) => void
}

const CONTENT_OPTIONS: { value: GoodReviewContentFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'hasImage', label: '有图' },
  { value: 'hasText', label: '有文字' },
  { value: 'both', label: '有图有文字' },
]

const REPLY_OPTIONS: { value: GoodReviewReplyFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'unreplied', label: '未回复' },
  { value: 'replied', label: '已回复' },
]

const SCORE_OPTIONS: { value: GoodReviewMinScoreFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: '5', label: '5 分' },
  { value: '4', label: '4 分及以上' },
]

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onSelect: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          className={`rounded-full px-3 py-1 text-xs transition ${
            value === opt.value
              ? 'bg-rose-500 text-white shadow-sm'
              : 'border border-slate-200 bg-white text-slate-600 hover:border-rose-100'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export const GoodReviewFiltersBar: React.FC<Props> = ({ filters, onChange }) => {
  const patch = (partial: Partial<GoodReviewListFilters>) => {
    onChange({ ...filters, ...partial })
  }

  return (
    <div
      className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
      data-testid="good-review-filters-bar"
    >
      <ChipGroup
        label="内容"
        options={CONTENT_OPTIONS}
        value={filters.content}
        onSelect={(content) => patch({ content })}
      />
      <ChipGroup
        label="回复"
        options={REPLY_OPTIONS}
        value={filters.replyStatus}
        onSelect={(replyStatus) => patch({ replyStatus })}
      />
      <ChipGroup
        label="商品评分"
        options={SCORE_OPTIONS}
        value={filters.minProductScore}
        onSelect={(minProductScore) => patch({ minProductScore })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-xs text-slate-500">素材标签</span>
        <button
          type="button"
          onClick={() => patch({ materialTag: '' })}
          className={`rounded-full px-3 py-1 text-xs transition ${
            !filters.materialTag
              ? 'bg-rose-500 text-white shadow-sm'
              : 'border border-slate-200 bg-white text-slate-600 hover:border-rose-100'
          }`}
        >
          全部
        </button>
        {GOOD_REVIEW_MATERIAL_TAG_OPTIONS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => patch({ materialTag: tag })}
            className={`rounded-full px-3 py-1 text-xs transition ${
              filters.materialTag === tag
                ? 'bg-rose-500 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-rose-100'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">商品关键词</span>
          <input
            type="search"
            value={filters.itemKeyword}
            onChange={(e) => patch({ itemKeyword: e.target.value })}
            placeholder="例如：手镯、平安扣"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">评价关键词</span>
          <input
            type="search"
            value={filters.reviewKeyword}
            onChange={(e) => patch({ reviewKeyword: e.target.value })}
            placeholder="例如：颜色好看、油润"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
        </label>
      </div>
    </div>
  )
}
