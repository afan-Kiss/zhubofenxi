/**
 * 已签收明细专用：签收时间解析 + 店铺→主播→签收时间三级排序
 * 不改变 isEffectiveSignedView / 日期范围 / 主播归属口径
 */
import { formatDateTimeShanghai, parseLiveSessionTimeMs } from '../utils/business-timezone'

export const SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC = 'shop_anchor_sign_desc' as const

export const SIGNED_ORDER_SORT_WHITELIST = [
  SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC,
  'anchor_asc',
  'amount_desc',
  'refund_desc',
  'time_desc',
] as const

export type SignedOrderSortMode = (typeof SIGNED_ORDER_SORT_WHITELIST)[number]

export type ResolvedSignedTime = {
  displayText: string | null
  timestampMs: number | null
  source: string | null
}

const SIGN_TIME_RAW_KEYS = [
  'signedAt',
  'signTime',
  'receiveTime',
  'finishTime',
  'completedAt',
] as const

function parseNumericEpoch(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 秒级 vs 毫秒
    if (value > 1e12) return Math.floor(value)
    if (value > 1e9) return Math.floor(value * 1000)
    return null
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return parseNumericEpoch(Number(value.trim()))
  }
  return null
}

/**
 * 统一解析签收时间（展示用规范化文本 + 排序用毫秒）。
 * 不得把下单时间伪装成签收时间；无效值返回 null。
 */
export function resolveSignedTime(value: unknown, sourceHint?: string | null): ResolvedSignedTime {
  if (value == null) {
    return { displayText: null, timestampMs: null, source: sourceHint ?? null }
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const ms = parseNumericEpoch(value)
    if (ms == null) {
      return { displayText: null, timestampMs: null, source: sourceHint ?? null }
    }
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) {
      return { displayText: null, timestampMs: null, source: sourceHint ?? null }
    }
    return {
      displayText: formatDateTimeShanghai(d),
      timestampMs: ms,
      source: sourceHint ?? 'epoch',
    }
  }
  const text = String(value).trim()
  if (!text || text === '—' || text === '-') {
    return { displayText: null, timestampMs: null, source: sourceHint ?? null }
  }
  const ms = parseLiveSessionTimeMs(text)
  if (ms == null) {
    return { displayText: null, timestampMs: null, source: sourceHint ?? null }
  }
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) {
    return { displayText: null, timestampMs: null, source: sourceHint ?? null }
  }
  return {
    displayText: formatDateTimeShanghai(d),
    timestampMs: ms,
    source: sourceHint ?? 'text',
  }
}

/** 从订单 raw 取签收时间候选并规范化 */
export function resolveSignedTimeFromRaw(
  raw: Record<string, unknown> | undefined,
): ResolvedSignedTime {
  if (!raw) return { displayText: null, timestampMs: null, source: null }
  for (const key of SIGN_TIME_RAW_KEYS) {
    if (!(key in raw) || raw[key] == null) continue
    const resolved = resolveSignedTime(raw[key], key)
    if (resolved.timestampMs != null || resolved.displayText) return resolved
  }
  return { displayText: null, timestampMs: null, source: null }
}

export function normalizeSignedOrderSort(sort: string | null | undefined): SignedOrderSortMode {
  const s = (sort ?? '').trim()
  if ((SIGNED_ORDER_SORT_WHITELIST as readonly string[]).includes(s)) {
    return s as SignedOrderSortMode
  }
  return SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC
}

function zhCmp(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function compareNullableTimeDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = a != null && Number.isFinite(a) ? a : null
  const bv = b != null && Number.isFinite(b) ? b : null
  if (av == null && bv == null) return 0
  if (av == null) return 1 // 缺失排后
  if (bv == null) return -1
  return bv - av
}

export type SignedSortableRow = {
  liveAccountName?: string | null
  liveAccountId?: string | null
  anchorName?: string | null
  anchorId?: string | null
  signTimeMs?: number | null
  orderTimeMs?: number | null
  orderTime?: string | null
  displayOrderNo?: string | null
  orderNo?: string | null
}

function shopSortKey(row: SignedSortableRow): { missing: boolean; name: string; id: string } {
  const name = (row.liveAccountName ?? '').trim()
  const id = (row.liveAccountId ?? '').trim()
  const missing = !name || name === '未知直播号' || name === '—'
  return { missing, name: missing ? '\uffff' : name, id }
}

function anchorSortKey(row: SignedSortableRow): { missing: boolean; name: string; id: string } {
  const name = (row.anchorName ?? '').trim()
  const id = (row.anchorId ?? '').trim()
  const unassigned = !name || name === '未归属' || name === '—'
  return { missing: unassigned, name: unassigned ? '\uffff' : name, id: id || name }
}

export function compareShop(a: SignedSortableRow, b: SignedSortableRow): number {
  const ka = shopSortKey(a)
  const kb = shopSortKey(b)
  if (ka.missing !== kb.missing) return ka.missing ? 1 : -1
  const byName = zhCmp(ka.name, kb.name)
  if (byName !== 0) return byName
  return zhCmp(ka.id, kb.id)
}

export function compareAnchor(a: SignedSortableRow, b: SignedSortableRow): number {
  const ka = anchorSortKey(a)
  const kb = anchorSortKey(b)
  if (ka.missing !== kb.missing) return ka.missing ? 1 : -1
  const byName = zhCmp(ka.name, kb.name)
  if (byName !== 0) return byName
  return zhCmp(ka.id, kb.id)
}

export function compareSignedRows(a: SignedSortableRow, b: SignedSortableRow): number {
  return (
    compareShop(a, b) ||
    compareAnchor(a, b) ||
    compareNullableTimeDesc(a.signTimeMs, b.signTimeMs) ||
    compareNullableTimeDesc(
      a.orderTimeMs ?? parseLiveSessionTimeMs(a.orderTime ?? undefined),
      b.orderTimeMs ?? parseLiveSessionTimeMs(b.orderTime ?? undefined),
    ) ||
    zhCmp(
      (a.displayOrderNo || a.orderNo || '').trim(),
      (b.displayOrderNo || b.orderNo || '').trim(),
    )
  )
}

export function sortSignedOrderRows<T extends SignedSortableRow>(rows: T[]): T[] {
  return [...rows].sort(compareSignedRows)
}

export type SignedGroupSummary = {
  shops: Array<{
    liveAccountId: string
    liveAccountName: string
    orderCount: number
    signedAmount: number
    anchorCount: number
    anchors: Array<{
      anchorId: string
      anchorName: string
      orderCount: number
      signedAmount: number
      latestSignTime: string | null
    }>
  }>
}

export function buildSignedGroupSummary(
  rows: Array<
    SignedSortableRow & {
      signedAmount?: number | null
      signTime?: string | null
    }
  >,
): SignedGroupSummary {
  type AnchorAgg = {
    anchorId: string
    anchorName: string
    orderCount: number
    signedAmount: number
    latestSignTimeMs: number | null
    latestSignTime: string | null
  }
  type ShopAgg = {
    liveAccountId: string
    liveAccountName: string
    orderCount: number
    signedAmount: number
    anchors: Map<string, AnchorAgg>
  }
  const shops = new Map<string, ShopAgg>()

  for (const row of rows) {
    const shopId = (row.liveAccountId || 'unknown').trim() || 'unknown'
    const shopName = (row.liveAccountName || '未知直播号').trim() || '未知直播号'
    let shop = shops.get(shopId)
    if (!shop) {
      shop = {
        liveAccountId: shopId,
        liveAccountName: shopName,
        orderCount: 0,
        signedAmount: 0,
        anchors: new Map(),
      }
      shops.set(shopId, shop)
    }
    const amount = Number(row.signedAmount ?? 0)
    shop.orderCount += 1
    shop.signedAmount += Number.isFinite(amount) ? amount : 0

    const anchorName = (row.anchorName || '未归属').trim() || '未归属'
    const anchorId = (row.anchorId || anchorName).trim() || anchorName
    const aKey = `${anchorId}::${anchorName}`
    let anchor = shop.anchors.get(aKey)
    if (!anchor) {
      anchor = {
        anchorId,
        anchorName,
        orderCount: 0,
        signedAmount: 0,
        latestSignTimeMs: null,
        latestSignTime: null,
      }
      shop.anchors.set(aKey, anchor)
    }
    anchor.orderCount += 1
    anchor.signedAmount += Number.isFinite(amount) ? amount : 0
    const stm = row.signTimeMs ?? null
    if (stm != null && (anchor.latestSignTimeMs == null || stm > anchor.latestSignTimeMs)) {
      anchor.latestSignTimeMs = stm
      anchor.latestSignTime = row.signTime ?? null
    }
  }

  const shopList = [...shops.values()].sort((a, b) =>
    compareShop(
      { liveAccountId: a.liveAccountId, liveAccountName: a.liveAccountName },
      { liveAccountId: b.liveAccountId, liveAccountName: b.liveAccountName },
    ),
  )

  return {
    shops: shopList.map((s) => {
      const anchors = [...s.anchors.values()].sort((a, b) =>
        compareAnchor(
          { anchorId: a.anchorId, anchorName: a.anchorName },
          { anchorId: b.anchorId, anchorName: b.anchorName },
        ),
      )
      return {
        liveAccountId: s.liveAccountId,
        liveAccountName: s.liveAccountName,
        orderCount: s.orderCount,
        signedAmount: Number(s.signedAmount.toFixed(2)),
        anchorCount: anchors.length,
        anchors: anchors.map((a) => ({
          anchorId: a.anchorId,
          anchorName: a.anchorName,
          orderCount: a.orderCount,
          signedAmount: Number(a.signedAmount.toFixed(2)),
          latestSignTime: a.latestSignTime,
        })),
      }
    }),
  }
}
