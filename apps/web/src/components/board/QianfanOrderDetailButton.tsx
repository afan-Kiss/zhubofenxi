import React, { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  isQianfanOrderDetailAvailable,
  openQianfanOrderDetail,
} from '../../lib/qianfan-order-detail'

interface Props {
  orderNo: string
  compact?: boolean
  className?: string
  label?: string
}

export const QianfanOrderDetailButton: React.FC<Props> = ({
  orderNo,
  compact = false,
  className = '',
  label = '查看千帆详情',
}) => {
  const [loading, setLoading] = useState(false)
  const trimmed = orderNo.trim()

  if (!isQianfanOrderDetailAvailable(trimmed)) return null

  const handleClick = async () => {
    if (loading) return
    setLoading(true)
    try {
      await openQianfanOrderDetail(trimmed)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '打开千帆订单详情失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      data-testid="board-qianfan-order-detail"
      disabled={loading}
      onClick={() => void handleClick()}
      className={`inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'text-[10px]' : 'text-[11px]'} ${className}`}
    >
      <ExternalLink size={compact ? 11 : 12} />
      {loading ? '打开中…' : label}
    </button>
  )
}
