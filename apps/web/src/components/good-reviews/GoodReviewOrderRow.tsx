import React, { useCallback, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { openGoodReviewArkOrderDetail, copyTextToClipboard } from '../../lib/good-reviews'

async function copyOrderNo(text: string): Promise<boolean> {
  return copyTextToClipboard(text)
}

interface Props {
  orderId: string | null
  shopKey: string
  compact?: boolean
}

export const GoodReviewOrderRow: React.FC<Props> = ({ orderId, shopKey, compact = false }) => {
  const [copied, setCopied] = useState(false)
  const trimmed = orderId?.trim() ?? ''

  const onCopy = useCallback(async () => {
    if (!trimmed) return
    const ok = await copyOrderNo(trimmed)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }, [trimmed])

  if (!trimmed) {
    return (
      <div className={`text-slate-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        订单号：接口未返回
      </div>
    )
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${compact ? 'text-[11px]' : 'text-xs'} text-slate-600`}
    >
      <span className="text-slate-500">订单号：</span>
      <span className="font-medium text-slate-800">{trimmed}</span>
      <button
        type="button"
        onClick={() => void onCopy()}
        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
      >
        {copied ? '已复制' : '复制'}
      </button>
      <button
        type="button"
        data-testid="good-reviews-ark-order-detail"
        title="打开千帆订单详情"
        onClick={() => openGoodReviewArkOrderDetail(trimmed, shopKey)}
        className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
      >
        <ExternalLink size={12} />
        千帆订单详情
      </button>
    </div>
  )
}
