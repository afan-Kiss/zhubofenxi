/** 福袋发货：类型与常量（HAR + 平台 live-Lottery JS 已核实） */

export const LUCKY_GIFT_REFERER = 'https://ark.xiaohongshu.com/live_lottery'
export const LUCKY_GIFT_ORIGIN = 'https://ark.xiaohongshu.com'
export const LUCKY_GIFT_ARK_PAGE = LUCKY_GIFT_REFERER

/** 千帆福袋页 service URL；带 lucky_draw_id 便于打开后定位到对应福袋 */
export function buildLuckyGiftArkServiceUrl(luckyDrawId?: string | null): string {
  const base = LUCKY_GIFT_ARK_PAGE
  const id = String(luckyDrawId || '').trim()
  if (!id) return base
  const u = new URL(base)
  u.searchParams.set('lucky_draw_id', id)
  return u.toString()
}

export const LUCKY_GIFT_API = {
  /** GET params: hostId, page, pageSize（当前/在播福袋，无 room_id 时常为空） */
  listPage: 'https://live-assistant.xiaohongshu.com/api/sns/red/live/lucky_draw/page',
  /** GET params: hostId, room_id, page, pageSize（历史福袋，生产已核实） */
  historyGet: 'https://live-assistant.xiaohongshu.com/api/sns/red/live/lucky_draw_history/get',
  /** GET query: lucky_draw_id（HAR 已确认） */
  winnerWithAddress:
    'https://live-assistant.xiaohongshu.com/api/sns/red/live/lucky_boy_with_address/get',
  /**
   * GET query: lucky_draw_id + user_id（平台 API_LIST.GET_DRAW_LOGISTICS_INFO）
   * 中奖列表接口常无 logistics，物流单号需按中奖人另查。
   */
  winnerLogistics:
    'https://live-assistant.xiaohongshu.com/api/sns/red/live/target_lucky_boy_with_address/get',
} as const

/** 列表分页：平台前端默认 pageSize=50，page 从 1 起 */
export const LUCKY_GIFT_LIST_PAGE_SIZE = 50

export type LuckyGiftShipmentStatus = 'no_address' | 'incomplete_address' | 'pending' | 'shipped'

export type LuckyGiftShippingStatusSource = 'local' | 'official'

export type LuckyGiftFreightType = 'COLLECT'

export interface LuckyGiftAddressFields {
  name: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
}

export interface NormalizedLuckyDraw {
  luckyDrawId: string
  roomId: string
  giftName: string
  senderUserId: string | null
  senderNickname: string | null
  drawStatus: number | null
  winnerCount: number
  createTimeMs: number | null
  startTimeMs: number | null
  raw: Record<string, unknown>
}

export interface NormalizedLuckyWinner {
  luckyDrawId: string
  winnerUserId: string
  winnerKey: string
  redId: string | null
  winnerNickname: string
  avatar: string | null
  address: LuckyGiftAddressFields | null
  hasAddress: boolean
  addressComplete: boolean
  addressMissing: string[]
  fullAddress: string | null
  officialCourier: string | null
  officialTrackingNo: string | null
  officialShipped: boolean
  raw: Record<string, unknown>
}

export interface LuckyGiftListPageResult {
  infos: NormalizedLuckyDraw[]
  totalCount: number | null
  rawText: string
  /** 列表页中原始 id 文本（用于精度校验） */
  rawIdTexts: string[]
}

export interface LuckyGiftRoomFetchStat {
  roomId: string
  pageCount: number
  fetchedCount: number
  status: import('./lucky-gift-platform-response.util').LuckyGiftSyncShopStatus
  error?: string
}

export interface LuckyGiftFetchAllResult {
  accountId: string
  accountName: string
  hostId: string
  hostIdSource: 'live_session' | 'cookie'
  draws: NormalizedLuckyDraw[]
  platformTotal: number | null
  fetchedCount: number
  dedupedCount: number
  pageCount: number
  roomsScanned: number
  roomsWithData: number
  roomStats: LuckyGiftRoomFetchStat[]
  listPageStatus: import('./lucky-gift-platform-response.util').LuckyGiftSyncShopStatus
  listPageError?: string
  syncStatus: import('./lucky-gift-platform-response.util').LuckyGiftSyncShopStatus
  syncStatusError?: string
}
