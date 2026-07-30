/**
 * 已签收明细专用：签收时间解析 + 店铺→主播→签收时间三级排序
 * 不改变 isEffectiveSignedView / 日期范围 / 主播归属口径
 */
import { formatDateTimeShanghai, parseLiveSessionTimeMs } from '../utils/business-timezone'
import { normalizeAnchorName } from '../utils/anchor-name-normalize.util'

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

/** 已签收下钻展示用主播身份：同名合并，避免同一人因不同 anchorId 重复出现 */
export function signedDrillAnchorIdentity(
  anchorId: string | null | undefined,
  anchorName: string | null | undefined,
): { key: string; id: string; name: string; unassigned: boolean } {
  const name = (anchorName ?? '').trim() || '未归属'
  const unassigned = !name || name === '未归属' || name === '—'
  if (unassigned) {
    return { key: '__unassigned__', id: '__unassigned__', name: '未归属', unassigned: true }
  }
  const idRaw = (anchorId ?? '').trim()
  return {
    key: normalizeAnchorName(name),
    id: idRaw || name,
    name,
    unassigned: false,
  }
}

const SIGN_TIME_RAW_KEYS = [
  'signedAt',
  'signTime',
  'receiveTime',
  'finishTime',
  'completedAt',
  'finishedAt',
  'orderFinishTime',
  'finish_time',
  'completed_time',
  'completeTime',
  'orderCompleteTime',
  'confirmReceiveTime',
  'confirm_receive_time',
  'confirmReceiveAt',
] as const

const NESTED_RAW_CONTAINERS = [
  'package',
  'order',
  'orderInfo',
  'packageInfo',
  'orderDetail',
  'data',
] as const

function collectRawTimeSources(raw: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [raw]
  for (const key of NESTED_RAW_CONTAINERS) {
    const nested = raw[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      out.push(nested as Record<string, unknown>)
    }
  }
  return out
}

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

/** 从订单 raw 取签收/完成时间候选并规范化（含嵌套 package/order） */
export function resolveSignedTimeFromRaw(
  raw: Record<string, unknown> | undefined,
): ResolvedSignedTime {
  if (!raw) return { displayText: null, timestampMs: null, source: null }
  for (const source of collectRawTimeSources(raw)) {
    for (const key of SIGN_TIME_RAW_KEYS) {
      if (!(key in source) || source[key] == null) continue
      const resolved = resolveSignedTime(source[key], key)
      if (resolved.timestampMs != null || resolved.displayText) return resolved
    }
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
  const identity = signedDrillAnchorIdentity(row.anchorId, row.anchorName)
  return {
    missing: identity.unassigned,
    name: identity.unassigned ? '\uffff' : identity.name,
    // 同名不因不同 id 拆开排序；id 仅作稳定次序
    id: identity.key,
  }
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

    const identity = signedDrillAnchorIdentity(row.anchorId, row.anchorName)
    const aKey = identity.key
    let anchor = shop.anchors.get(aKey)
    if (!anchor) {
      anchor = {
        anchorId: identity.id,
        anchorName: identity.name,
        orderCount: 0,
        signedAmount: 0,
        latestSignTimeMs: null,
        latestSignTime: null,
      }
      shop.anchors.set(aKey, anchor)
    } else if (
      identity.id &&
      identity.id !== identity.name &&
      (!anchor.anchorId || anchor.anchorId === anchor.anchorName)
    ) {
      // 优先保留真实主播 id（而非仅用姓名回退）
      anchor.anchorId = identity.id
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
