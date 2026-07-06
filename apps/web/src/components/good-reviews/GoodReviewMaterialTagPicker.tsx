import React, { useCallback, useState } from 'react'
import {
  GOOD_REVIEW_MATERIAL_TAG_OPTIONS,
  saveGoodReviewMaterialTags,
  type GoodReviewItemView,
} from '../../lib/good-reviews'

interface Props {
  review: GoodReviewItemView
  onUpdated: (review: GoodReviewItemView) => void
  compact?: boolean
}

export const GoodReviewMaterialTagPicker: React.FC<Props> = ({
  review,
  onUpdated,
  compact = false,
}) => {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleTag = useCallback(
    async (tag: string) => {
      const current = new Set(review.materialTags ?? [])
      if (current.has(tag)) current.delete(tag)
      else current.add(tag)
      const next = [...current]
      setSaving(true)
      setError('')
      try {
        const updated = await saveGoodReviewMaterialTags(review.id, next)
        onUpdated(updated)
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存标签失败')
      } finally {
        setSaving(false)
      }
    },
    [review.id, review.materialTags, onUpdated],
  )

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {!compact ? (
        <p className="text-xs text-slate-500">给这条好评打标签，后面主播找素材更快。</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {GOOD_REVIEW_MATERIAL_TAG_OPTIONS.map((tag) => {
          const active = (review.materialTags ?? []).includes(tag)
          return (
            <button
              key={tag}
              type="button"
              disabled={saving}
              data-testid={`good-review-material-tag-${tag}`}
              onClick={(e) => {
                e.stopPropagation()
                void toggleTag(tag)
              }}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition disabled:opacity-60 ${
                active
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-rose-100 hover:bg-rose-50/50'
              }`}
            >
              {tag}
            </button>
          )
        })}
      </div>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  )
}
