import { createHash } from 'node:crypto'
import type { AnalyzedOrderView } from '../types/analysis'

export type BuyerIdentitySource =
  | 'official_buyer_id'
  | 'receiver_hash'
  | 'nickname_fallback'
  | 'order_no_fallback'

export interface BuyerIdentity {
  /** 聚合 / 查询 / 缓存唯一键 */
  key: string
  buyerKey: string
  /** 官方买家 ID（若有） */
  buyerId?: string
  buyerNickname?: string
  buyerDisplayName: string
  buyerShortCode: string
  buyerDisplayLabel: string
  identitySource: BuyerIdentitySource
  /** @deprecated 兼容旧代码：等同 buyerDisplayName */
  nickname: string
}

export interface BuyerDisplayFields {
  buyerNickname?: string
  buyerDisplayName: string
  buyerShortCode: string
  buyerDisplayLabel: string
}

/** 官方买家 ID 优先级：buyerId → user_id → xhs_user_id → buyerOpenId */
const FLAT_OFFICIAL_ID_KEYS = [
  'buyerId',
  'buyer_id',
  'user_id',
  'userId',
  'xhs_user_id',
  'xhsUserId',
  'buyerOpenId',
  'buyer_open_id',
  'buyerUserId',
  'buyer_user_id',
  'customerId',
  'customer_id',
  'redId',
  'red_id',
  'openId',
  'open_id',
  'receiverUserId',
  'accountId',
  'account_id',
] as const

const USER_INFO_ID_KEYS = [
  'buyerId',
  'buyer_id',
  'user_id',
  'userId',
  'xhs_user_id',
  'xhsUserId',
  'buyerOpenId',
  'buyer_open_id',
  'buyerUserId',
  'buyer_user_id',
  'customerId',
  'customer_id',
  'redId',
  'red_id',
  'openId',
  'open_id',
] as const

const NICKNAME_KEYS = ['nickName', 'nick_name', 'nickname', 'buyerNick', 'buyer_nick', 'buyerName', 'buyer_name']

const RECEIVER_NAME_KEYS = [
  'receiverName',
  'receiver_name',
  'consigneeName',
  'consignee_name',
  'name',
]
const RECEIVER_PHONE_KEYS = [
  'receiverPhone',
  'receiver_phone',
  'receiverMobile',
  'receiver_mobile',
  'mobile',
  'phone',
  'receiverPhoneMask',
  'maskedPhone',
  'receiver_phone_mask',
]
const RECEIVER_ADDRESS_KEYS = [
  'receiverAddress',
  'receiver_address',
  'address',
  'detailAddress',
  'detail_address',
  'fullAddress',
]

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function normalizeHashPart(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

function pickNestedString(raw: Record<string, unknown>, containers: string[], keys: readonly string[]): string {
  for (const c of containers) {
    const nested = raw[c]
    if (nested && typeof nested === 'object') {
      const s = pickString(nested as Record<string, unknown>, keys)
      if (s) return s
    }
  }
  return pickString(raw, keys)
}

/** 原始买家昵称（无则返回空字符串，便于区分「未知买家」） */
export function pickBuyerNicknameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const cached = raw._buyerNickname
  if (cached != null && String(cached).trim()) return String(cached).trim()
  const u = raw.userInfo
  if (u && typeof u === 'object') {
    const nick = pickString(u as Record<string, unknown>, NICKNAME_KEYS)
    if (nick) return nick
  }
  const pkgNick = pickString(raw, ['buyerNick', 'buyer_nick', 'buyerName', 'buyer_name'])
  if (pkgNick) return pkgNick
  return ''
}

/** 脱敏收货人名（仅作展示兜底，不参与 buyerKey） */
export function pickReceiverMaskedNameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const containers = ['receiverInfo', 'receiver_info', 'addressInfo', 'address_info', 'consigneeInfo']
  const name = pickNestedString(raw, containers, RECEIVER_NAME_KEYS)
  if (name) return name
  return pickString(raw, ['receiverName', 'receiver_name', 'consigneeName', 'consignee_name'])
}

/** 展示主名称：buyerNickname > receiverMaskedName > 未知买家 */
export function resolveBuyerDisplayName(raw: Record<string, unknown> | undefined): string {
  const nick = pickBuyerNicknameFromRaw(raw)
  if (nick) return nick
  const receiver = pickReceiverMaskedNameFromRaw(raw)
  if (receiver) return receiver
  return '未知买家'
}

export function buyerShortCodeFromKey(buyerKey: string, officialBuyerId?: string | null): string {
  return formatBuyerIdentityCode(buyerKey, officialBuyerId)
}

export function buildBuyerDisplayLabel(
  buyerDisplayName: string,
  buyerShortCode: string,
): string {
  const name = buyerDisplayName.trim()
  const code = buyerShortCode.trim()
  if (name && name !== '未知买家' && code && code !== '—') {
    return `${name} #${code}`
  }
  if (name && name !== '未知买家') return name
  if (code && code !== '—') return `未知买家 #${code}`
  return '未知买家'
}

export function buildBuyerDisplayFields(
  buyerKey: string,
  raw: Record<string, unknown> | undefined,
  officialBuyerId?: string | null,
): BuyerDisplayFields {
  const buyerNickname = pickBuyerNicknameFromRaw(raw) || undefined
  const buyerDisplayName = resolveBuyerDisplayName(raw)
  const buyerShortCode = buyerShortCodeFromKey(buyerKey, officialBuyerId)
  const buyerDisplayLabel = buildBuyerDisplayLabel(buyerDisplayName, buyerShortCode)
  return { buyerNickname, buyerDisplayName, buyerShortCode, buyerDisplayLabel }
}

export function pickBuyerNicknameFromView(v: AnalyzedOrderView): string {
  const ext = v as AnalyzedOrderView & {
    raw?: Record<string, unknown>
    buyerNickname?: string
  }
  if (ext.buyerNickname?.trim()) return ext.buyerNickname.trim()
  const nick = pickBuyerNicknameFromRaw(ext.raw)
  if (nick) return nick
  return ''
}

function extractOfficialBuyerId(
  raw: Record<string, unknown>,
  nickname: string,
): { id: string; prefix: string } | null {
  const userInfo = raw.userInfo
  if (userInfo && typeof userInfo === 'object') {
    const u = userInfo as Record<string, unknown>
    const id = pickString(u, USER_INFO_ID_KEYS)
    if (id && id !== '未知买家' && id !== nickname) {
      return { id, prefix: 'xhs_user' }
    }
  }
  const flat = pickString(raw, FLAT_OFFICIAL_ID_KEYS)
  if (flat && flat !== '未知买家' && flat !== nickname) {
    return { id: flat, prefix: 'xhs_user' }
  }
  return null
}

function buildReceiverHash(raw: Record<string, unknown>): string | null {
  const containers = ['receiverInfo', 'receiver_info', 'addressInfo', 'address_info', 'consigneeInfo']
  const name = pickNestedString(raw, containers, RECEIVER_NAME_KEYS)
  const phone = pickNestedString(raw, containers, RECEIVER_PHONE_KEYS)
  const address = pickNestedString(raw, containers, RECEIVER_ADDRESS_KEYS)
  if (!name && !phone && !address) return null
  const payload = [normalizeHashPart(name), normalizeHashPart(phone), normalizeHashPart(address)].join('|')
  if (payload === '||') return null
  const hash = createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16)
  return `fallback:${hash}`
}

export interface ResolveBuyerIdentityInput {
  raw?: Record<string, unknown>
  buyerId?: string
  orderNo?: string
}

/** 从订单 raw / normalized 字段解析买家唯一标识（禁止用昵称合并） */
export function resolveBuyerIdentity(input: ResolveBuyerIdentityInput): BuyerIdentity | null {
  const raw = input.raw ?? {}
  const orderNo = (input.orderNo ?? pickString(raw, ['displayOrderNo', 'packageId', 'orderId', 'orderNo']) ?? '').trim()

  const cachedKey = raw._buyerKey != null ? String(raw._buyerKey).trim() : ''
  const cachedSource = raw._buyerIdentitySource != null ? String(raw._buyerIdentitySource).trim() : ''
  const nickname = pickBuyerNicknameFromRaw(raw)

  if (cachedKey && isValidBuyerKey(cachedKey, nickname)) {
    const officialId =
      raw._buyerOfficialId != null
        ? String(raw._buyerOfficialId).trim()
        : extractOfficialIdFromBuyerKey(cachedKey)
    return toIdentity(
      cachedKey,
      officialId || undefined,
      nickname || undefined,
      raw,
      (cachedSource as BuyerIdentitySource) || inferSourceFromKey(cachedKey),
    )
  }

  const official = extractOfficialBuyerId(raw, nickname)
  if (official) {
    const buyerKey = `${official.prefix}:${official.id}`
    return toIdentity(buyerKey, official.id, nickname || undefined, raw, 'official_buyer_id')
  }

  const rawBuyerId = (input.buyerId ?? pickString(raw, FLAT_OFFICIAL_ID_KEYS) ?? '').trim()
  if (rawBuyerId && rawBuyerId !== '未知买家' && rawBuyerId !== nickname) {
    const buyerKey = `xhs_user:${rawBuyerId}`
    return toIdentity(buyerKey, rawBuyerId, nickname || undefined, raw, 'official_buyer_id')
  }

  const receiverKey = buildReceiverHash(raw)
  if (receiverKey) {
    return toIdentity(receiverKey, undefined, nickname || undefined, raw, 'receiver_hash')
  }

  if (nickname && nickname !== '未知买家') {
    const buyerKey = `nick:${nickname}`
    return toIdentity(buyerKey, undefined, nickname, raw, 'nickname_fallback')
  }

  if (orderNo) {
    const buyerKey = `unknown:${orderNo}`
    return toIdentity(buyerKey, undefined, nickname || undefined, raw, 'order_no_fallback')
  }

  return null
}

function toIdentity(
  buyerKey: string,
  buyerId: string | undefined,
  buyerNickname: string | undefined,
  raw: Record<string, unknown>,
  identitySource: BuyerIdentitySource,
): BuyerIdentity {
  const display = buildBuyerDisplayFields(buyerKey, raw, buyerId)
  const nick = buyerNickname ?? display.buyerNickname
  const buyerDisplayName =
    nick ? nick : display.buyerDisplayName
  const buyerDisplayLabel = buildBuyerDisplayLabel(buyerDisplayName, display.buyerShortCode)
  return {
    key: buyerKey,
    buyerKey,
    buyerId,
    buyerNickname: nick,
    buyerDisplayName,
    buyerShortCode: display.buyerShortCode,
    buyerDisplayLabel,
    identitySource,
    nickname: buyerDisplayName,
  }
}

function inferSourceFromKey(buyerKey: string): BuyerIdentitySource {
  if (buyerKey.startsWith('fallback:')) return 'receiver_hash'
  if (buyerKey.startsWith('nick:')) return 'nickname_fallback'
  if (buyerKey.startsWith('unknown:')) return 'order_no_fallback'
  return 'official_buyer_id'
}

function extractOfficialIdFromBuyerKey(buyerKey: string): string {
  if (buyerKey.startsWith('xhs_user:')) return buyerKey.slice('xhs_user:'.length)
  return ''
}

/** 订单归一化阶段写入 raw 时调用 */
export function resolveBuyerIdentityForPackage(
  pkg: Record<string, unknown>,
  orderNo: string,
): BuyerIdentity | null {
  return resolveBuyerIdentity({ raw: pkg, orderNo })
}

export function attachBuyerIdentityToRaw(
  pkg: Record<string, unknown>,
  identity: BuyerIdentity,
): void {
  pkg._buyerKey = identity.buyerKey
  pkg._buyerIdentitySource = identity.identitySource
  if (identity.buyerId) pkg._buyerOfficialId = identity.buyerId
  if (identity.buyerNickname) pkg._buyerNickname = identity.buyerNickname
  pkg._buyerDisplayName = identity.buyerDisplayName
  pkg._buyerDisplayLabel = identity.buyerDisplayLabel
}

export function resolveBuyerIdentityFromView(v: AnalyzedOrderView): BuyerIdentity | null {
  const ext = v as AnalyzedOrderView & {
    raw?: Record<string, unknown>
    buyerNickname?: string
    buyerDisplayName?: string
    buyerDisplayLabel?: string
    buyerShortCode?: string
  }
  const orderNo = v.displayOrderNo || v.officialOrderNo || v.packageId || v.matchOrderId
  const base = resolveBuyerIdentity({ raw: ext.raw ?? {}, buyerId: v.buyerId, orderNo })
  if (!base) return null
  const nick = ext.buyerNickname?.trim() || pickBuyerNicknameFromView(v)
  if (nick && (!base.buyerNickname || base.buyerDisplayName === '未知买家')) {
    const display = buildBuyerDisplayFields(base.buyerKey, ext.raw ?? {}, base.buyerId)
    const buyerDisplayName = nick
    const buyerDisplayLabel = buildBuyerDisplayLabel(buyerDisplayName, display.buyerShortCode)
    return {
      ...base,
      buyerNickname: nick,
      buyerDisplayName,
      buyerDisplayLabel,
      nickname: buyerDisplayName,
    }
  }
  if (ext.buyerDisplayLabel?.trim()) {
    return {
      ...base,
      buyerDisplayLabel: ext.buyerDisplayLabel,
      buyerDisplayName: ext.buyerDisplayName ?? base.buyerDisplayName,
      buyerShortCode: ext.buyerShortCode ?? base.buyerShortCode,
    }
  }
  return base
}

/** 展示用买家识别码（后 6 位），不暴露完整手机号/地址 */
export function formatBuyerIdentityCode(buyerKey: string, officialBuyerId?: string | null): string {
  const official = (officialBuyerId ?? '').trim()
  if (official && official !== '未知买家' && !official.startsWith('nick:')) {
    return official.length <= 6 ? official : official.slice(-6)
  }
  const key = buyerKey.trim()
  if (!key || key.startsWith('nick:')) return '—'
  if (key.includes(':')) {
    const tail = key.split(':').pop() ?? key
    return tail.length <= 6 ? tail.toUpperCase() : tail.slice(-6).toUpperCase()
  }
  return key.length <= 6 ? key : key.slice(-6)
}

/** 展示用买家 ID：不暴露 nick: / fallback 全文 */
export function formatDisplayBuyerId(buyerId: string | null | undefined): string {
  const id = (buyerId ?? '').trim()
  if (!id || id === '—' || id === '未知买家') return '—'
  if (id.startsWith('nick:')) return '—'
  if (id.startsWith('fallback:') || id.startsWith('unknown:') || id.startsWith('xhs_user:')) {
    return formatBuyerIdentityCode(id, extractOfficialIdFromBuyerKey(id) || undefined)
  }
  return id.length <= 12 ? id : id.slice(-6)
}

export function viewMatchesBuyerKey(v: AnalyzedOrderView, buyerKey: string): boolean {
  const key = buyerKey.trim()
  if (!key) return false
  const id = resolveBuyerIdentityFromView(v)
  return id?.key === key
}

export function isValidBuyerKey(buyerKey: string, nickname?: string): boolean {
  const key = buyerKey.trim()
  if (!key) return false
  if (key.startsWith('nick:')) return false
  const nick = (nickname ?? '').trim()
  if (nick && key === nick) return false
  if (!key.includes(':') && nick && key === nick) return false
  return true
}

export function isStaleBuyerRankingKey(buyerKey: string, nickname?: string): boolean {
  const key = buyerKey.trim()
  if (!key) return true
  if (key.startsWith('nick:')) return true
  const nick = (nickname ?? '').trim()
  if (nick && (key === nick || key === `nick:${nick}`)) return true
  if (!key.includes(':') && nick && key === nick) return true
  return false
}

export const BUYER_IDENTITY_SOURCE_LABELS: Record<BuyerIdentitySource, string> = {
  official_buyer_id: '官方买家ID',
  receiver_hash: '收货信息辅助识别',
  nickname_fallback: '昵称兜底（不可用于售后查询）',
  order_no_fallback: '单订单兜底',
}
