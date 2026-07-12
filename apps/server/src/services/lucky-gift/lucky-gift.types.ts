/** 福袋发货：类型与常量（HAR + 平台 live-Lottery JS 已核实） */

export const LUCKY_GIFT_REFERER = 'https://ark.xiaohongshu.com/live_lottery'
export const LUCKY_GIFT_ORIGIN = 'https://ark.xiaohongshu.com'

export const LUCKY_GIFT_API = {
  /** GET params: hostId, page, pageSize（前端 getAllDrawRecord 已确认） */
  listPage: 'https://live-assistant.xiaohongshu.com/api/sns/red/live/lucky_draw/page',
  /** GET query: lucky_draw_id（HAR 已确认） */
  winnerWithAddress:
    'https://live-assistant.xiaohongshu.com/api/sns/red/live/lucky_boy_with_address/get',
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
