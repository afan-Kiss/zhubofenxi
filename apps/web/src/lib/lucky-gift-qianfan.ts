import { apiRequest } from './api'

/** 福袋待发货：换票后打开千帆福袋页（可带 lucky_draw_id 定位） */
export async function openQianfanLuckyGift(winnerId: string): Promise<void> {
  const id = winnerId.trim()
  if (!id) {
    throw new Error('记录无效')
  }
  const newWin = window.open('about:blank', '_blank')
  if (!newWin) {
    throw new Error('浏览器拦截了弹窗，请允许弹窗后重试')
  }
  try {
    const res = await apiRequest<{ openUrl: string }>('/api/board/lucky-gifts/qianfan-ticket', {
      method: 'POST',
      body: JSON.stringify({ winnerId: id }),
    })
    if (!res.openUrl) {
      newWin.close()
      throw new Error('暂时无法打开千帆福袋页')
    }
    newWin.location.href = res.openUrl
  } catch (err) {
    newWin.close()
    throw err instanceof Error ? err : new Error('打开千帆福袋页失败')
  }
}
