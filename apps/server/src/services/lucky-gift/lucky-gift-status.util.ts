import type { LuckyGiftShipmentStatus } from './lucky-gift.types'

export function deriveLuckyGiftShipmentStatus(input: {
  hasAddress: boolean
  addressComplete: boolean
  markedShipped: boolean
  officialShipped?: boolean
}): LuckyGiftShipmentStatus {
  if (input.markedShipped || input.officialShipped) return 'shipped'
  if (!input.hasAddress) return 'no_address'
  if (!input.addressComplete) return 'incomplete_address'
  return 'pending'
}

export function isActionablePendingStatus(status: LuckyGiftShipmentStatus): boolean {
  return status === 'no_address' || status === 'incomplete_address' || status === 'pending'
}

export function shipmentStatusLabel(status: LuckyGiftShipmentStatus): string {
  switch (status) {
    case 'no_address':
      return '未填地址'
    case 'incomplete_address':
      return '地址不完整'
    case 'pending':
      return '待发货'
    case 'shipped':
      return '已发货'
    default:
      return status
  }
}

export function shippingSourceLabel(source: string): string {
  return source === 'official' ? '平台状态' : '本系统标记'
}

/** 中奖后天数（按本地日历日） */
export function daysSinceWin(winTime: Date | null | undefined, now = new Date()): number | null {
  if (!winTime) return null
  const start = new Date(winTime)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  return diff >= 0 ? diff + 1 : null
}
