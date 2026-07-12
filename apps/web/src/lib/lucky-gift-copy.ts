/** 前端福袋复制文本（与后端 lucky-gift-copy.util 保持一致） */

export interface LuckyGiftCopyItem {
  liveAccountName: string
  giftName: string
  recipientName?: string | null
  recipientPhone?: string | null
  fullAddress?: string | null
  winnerNickname?: string | null
  redId?: string | null
  winTime?: string | null
  shipmentStatus?: string
  addressComplete?: boolean
  hasAddress?: boolean
}

function formatWinTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function buildLuckyGiftShipCopyText(items: LuckyGiftCopyItem[]): string {
  const blocks = items.map((item, idx) => {
    const shop = item.liveAccountName || '未知店铺'
    const gift = item.giftName || '直播福袋'
    return [
      `${idx + 1}. 【${shop}】直播福袋`,
      '',
      `收件人：${item.recipientName || '—'}`,
      `手机号：${item.recipientPhone || '—'}`,
      `收货地址：${item.fullAddress || '—'}`,
      `物品：${gift}`,
      '运费：到付',
      '备注：直播间福袋',
    ].join('\n')
  })
  return blocks.join('\n\n--------------------\n\n')
}

export function buildLuckyGiftAuditCopyText(items: LuckyGiftCopyItem[]): string {
  return items
    .map((item) => {
      if (item.shipmentStatus === 'no_address' || !item.hasAddress) {
        return [
          '【未填地址】',
          `店铺：${item.liveAccountName || '—'}`,
          `中奖人：${item.winnerNickname || '—'}`,
          `福袋：${item.giftName || '—'}`,
          `中奖时间：${formatWinTime(item.winTime)}`,
          '状态：尚未填写地址',
        ].join('\n')
      }
      if (item.shipmentStatus === 'incomplete_address' || !item.addressComplete) {
        return [
          '【地址不完整】',
          `店铺：${item.liveAccountName || '—'}`,
          `中奖人：${item.winnerNickname || '—'}`,
          `收件人：${item.recipientName || '—'}`,
          `手机号：${item.recipientPhone || '—'}`,
          `地址：${item.fullAddress || '—'}`,
          `福袋：${item.giftName || '—'}`,
          `中奖时间：${formatWinTime(item.winTime)}`,
        ].join('\n')
      }
      if (item.shipmentStatus === 'shipped') {
        return [
          '【已发货】',
          `店铺：${item.liveAccountName || '—'}`,
          `收件人：${item.recipientName || '—'}`,
          `手机号：${item.recipientPhone || '—'}`,
          `地址：${item.fullAddress || '—'}`,
          `福袋：${item.giftName || '—'}`,
        ].join('\n')
      }
      return [
        '【待发货】',
        `店铺：${item.liveAccountName || '—'}`,
        `收件人：${item.recipientName || '—'}`,
        `手机号：${item.recipientPhone || '—'}`,
        `地址：${item.fullAddress || '—'}`,
        `福袋：${item.giftName || '—'}`,
        '运费：到付',
      ].join('\n')
    })
    .join('\n\n--------------------\n\n')
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
