import React, { useCallback, useState } from 'react'
import { Copy } from 'lucide-react'
import {
  buildGoodReviewLiveScript,
  copyTextToClipboard,
  type GoodReviewItemView,
} from '../../lib/good-reviews'

interface Props {
  review: GoodReviewItemView
  shopName: string
  compact?: boolean
}

export const GoodReviewCopyScriptButton: React.FC<Props> = ({
  review,
  shopName,
  compact = false,
}) => {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(async () => {
    const text = buildGoodReviewLiveScript(review, shopName)
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }, [review, shopName])

  return (
    <button
      type="button"
      data-testid="good-review-copy-live-script"
      onClick={(e) => {
        e.stopPropagation()
        void onCopy()
      }}
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-100 ${
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs'
      }`}
    >
      <Copy size={compact ? 12 : 14} />
      {copied ? '已复制' : '复制直播话术'}
    </button>
  )
}
