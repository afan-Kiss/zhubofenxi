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
  const newWin = window.open('about:blank', '_blank')
  if (!newWin) {
    throw new Error('浏览器拦截了弹窗，请允许弹窗后重试')
  }
  try {
    const res = await apiRequest<{ openUrl: string }>('/api/board/qianfan-order-detail-ticket', {
      method: 'POST',
      body: JSON.stringify({ orderNo: trimmed }),
    })
    if (!res.openUrl) {
      newWin.close()
      throw new Error('暂时无法打开千帆订单详情')
    }
    newWin.location.href = res.openUrl
  } catch (err) {
    newWin.close()
    throw err instanceof Error ? err : new Error('打开千帆订单详情失败')
  }
}
