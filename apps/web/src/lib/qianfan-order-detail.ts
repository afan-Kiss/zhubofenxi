import { apiRequest } from './api'

export function isQianfanOrderDetailAvailable(orderNo: string | null | undefined): boolean {
  const trimmed = orderNo?.trim() ?? ''
  return Boolean(trimmed && trimmed !== '—')
}

/** 经营看板抽屉：换票后打开千帆订单详情（与运营报表抽屉同接口） */
export async function openQianfanOrderDetail(orderNo: string): Promise<void> {
  const trimmed = orderNo.trim()
  if (!isQianfanOrderDetailAvailable(trimmed)) {
    throw new Error('订单号无效')
  }
  const res = await apiRequest<{ openUrl: string }>('/api/board/qianfan-order-detail-ticket', {
    method: 'POST',
    body: JSON.stringify({ orderNo: trimmed }),
  })
  if (!res.openUrl) {
    throw new Error('暂时无法打开千帆订单详情')
  }
  window.open(res.openUrl, '_blank', 'noopener,noreferrer')
}
