export type CookieHealthStatus = 'valid' | 'invalid' | 'suspected' | 'unknown'
export type CookieStatusLevel = 'ok' | 'warning' | 'error'
export type CookieUploadSource = 'manual' | 'api' | 'unknown'

export function cookieUploadSourceLabel(source: CookieUploadSource | undefined): string {
  switch (source) {
    case 'api':
      return 'API 上传'
    case 'manual':
      return '手动上传'
    default:
      return '—'
  }
}

export type ShopCookieHealthStatus =
  | 'ok'
  | 'missing'
  | 'incomplete'
  | 'stale'
  | 'invalid'
  | 'unknown'

export interface ShopCookieHealthResult {
  shopCode: string
  shopName: string
  displayName: string
  status: ShopCookieHealthStatus
  ok: boolean
  checkedAt: string | null
  updatedAt: string | null
  reason: string
  failedEndpoint: string | null
  httpStatus: number | null
  hasCookie: boolean
  hasArkToken: boolean
  hasSellerToken: boolean
  hasA1?: boolean
  source?: string
  accountId: string | null
}

export interface LiveAccountPublic {
  id: string
  name: string
  enabled: boolean
  hasCookie: boolean
  /** 完整 Cookie（系统设置页） */
  cookie?: string | null
  cookieText?: string | null
  cookiePreview: string | null
  cookieUpdatedAt: string | null
  cookieUpdatedBy?: string | null
  cookieUploadSource?: CookieUploadSource
  cookieStatus: CookieHealthStatus
  cookieLastCheckedAt: string | null
  cookieLastSuccessAt: string | null
  cookieLastFailedAt: string | null
  cookieLastErrorCode: string | null
  cookieLastErrorMessage: string | null
  cookieLastFailedApi: string | null
  affectedBusinessSync: boolean
  lastSyncSuccessAt: string | null
  canSyncOrders?: boolean
  syncReason?: string
  /** 四店官方 shopKey（外部上传会覆盖此账号 Cookie） */
  officialShopKey?: string | null
  /** 历史重复账号：同名店铺但非官方 platformName */
  legacyShopKey?: string | null
  statusLevel?: CookieStatusLevel
  cookieDisplayStatus?: string
  /** 四店统一健康状态（与 /api/shop-cookies/health 一致） */
  healthStatus?: ShopCookieHealthStatus | string
}

export interface CookieHealthSummary {
  enabledCount: number
  validCount: number
  invalidCount: number
  suspectedCount: number
  unknownCount: number
  canSyncCount?: number
  cannotSyncCount?: number
  missingCookieCount?: number
  missingA1Count?: number
  missingArkCount?: number
  expiredCount?: number
}

export interface CookieHealthPayload {
  ok?: boolean
  accounts: LiveAccountPublic[]
  summary: CookieHealthSummary
  degraded?: boolean
  errorMessage?: string
}

export function clearCookieExpiredModalShownKeys(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem('cookie-expired-modal-shown')
}

/** 四店官方账号固定展示顺序 */
export const OFFICIAL_SHOP_KEYS_ORDER = [
  'shiyuju',
  'hetianyayu',
  'xiangyu',
  'xyxiangyu',
] as const

export const OFFICIAL_SHOP_DISPLAY_NAMES: Record<(typeof OFFICIAL_SHOP_KEYS_ORDER)[number], string> = {
  shiyuju: '拾玉居和田玉',
  hetianyayu: '和田雅玉',
  xiangyu: '祥钰珠宝',
  xyxiangyu: 'XY祥钰珠宝',
}

export function getOfficialShopDisplayName(shopKey: string | null | undefined): string | null {
  if (!shopKey) return null
  return OFFICIAL_SHOP_DISPLAY_NAMES[shopKey as keyof typeof OFFICIAL_SHOP_DISPLAY_NAMES] ?? null
}

export function isLegacyDuplicateAccount(account: LiveAccountPublic): boolean {
  return Boolean(account.legacyShopKey && !account.officialShopKey)
}

export function getAccountDisplayName(account: LiveAccountPublic): string {
  if (account.officialShopKey) {
    return getOfficialShopDisplayName(account.officialShopKey) ?? account.name
  }
  return account.name
}

export function partitionLiveAccounts(accounts: LiveAccountPublic[]): {
  activeAccounts: LiveAccountPublic[]
  legacyAccounts: LiveAccountPublic[]
} {
  const legacyAccounts: LiveAccountPublic[] = []
  const activeAccounts: LiveAccountPublic[] = []
  for (const account of accounts) {
    if (isLegacyDuplicateAccount(account)) legacyAccounts.push(account)
    else activeAccounts.push(account)
  }
  const orderIndex = new Map<string, number>(
    OFFICIAL_SHOP_KEYS_ORDER.map((key, index) => [key, index]),
  )
  activeAccounts.sort((a, b) => {
    const aOfficial = a.officialShopKey
    const bOfficial = b.officialShopKey
    if (aOfficial && bOfficial) {
      return (orderIndex.get(aOfficial) ?? 99) - (orderIndex.get(bOfficial) ?? 99)
    }
    if (aOfficial) return -1
    if (bOfficial) return 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  legacyAccounts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return { activeAccounts, legacyAccounts }
}

export interface CookieSessionTest {
  ok: boolean
  checkedAt: string
  status?: 'valid' | 'invalid' | 'limited' | 'unknown' | 'testing'
}

export function isCookieHealthBlocking(status: ShopCookieHealthStatus | string | undefined): boolean {
  return status === 'missing' || status === 'incomplete' || status === 'invalid'
}

export function resolveHealthFriendlyLabel(
  account: LiveAccountPublic,
  sessionTest?: CookieSessionTest | null,
): string {
  if (sessionTest?.status === 'testing') return '检测中…'
  if (resolveAccountCookieAvailable(account, sessionTest)) {
    if (sessionTest?.ok || account.cookieLastCheckedAt) return '校验通过'
    return '已收到 Cookie'
  }
  if (account.healthStatus === 'missing') {
    return `${getAccountDisplayName(account)}尚未收到 Cookie，请推送或粘贴`
  }
  if (account.healthStatus === 'incomplete') {
    return `${getAccountDisplayName(account)} Cookie 不完整，请重新推送完整 Cookie`
  }
  if (account.healthStatus === 'invalid' || account.cookieStatus === 'invalid') {
    return account.syncReason?.trim() || account.cookieLastErrorMessage?.trim() || '检测未通过，请重新推送 Cookie'
  }
  if (account.syncReason?.trim()) return account.syncReason.trim()
  return resolveAccountCookieFriendlyReason(account, sessionTest) ?? 'Cookie 不可用'
}

/** 上传即视为可用；仅手动「检测」失败或结构不完整时为不可用 */
export function accountCookieAvailable(account: LiveAccountPublic): boolean {
  if (!account.hasCookie) return false
  if (account.healthStatus && isCookieHealthBlocking(account.healthStatus)) return false
  if (account.cookieStatus === 'invalid') return false
  if (account.healthStatus === 'ok') return true
  if (account.canSyncOrders === true) return true
  if (account.cookieStatus === 'valid') return true
  return false
}

/** 列表、详情、统计共用：优先采用比服务端记录更新的本次检测结果 */
export function resolveAccountCookieAvailable(
  account: LiveAccountPublic,
  sessionTest?: CookieSessionTest | null,
): boolean {
  if (sessionTest?.status === 'testing') {
    return accountCookieAvailable(account)
  }
  if (sessionTest) {
    const testAt = Date.parse(sessionTest.checkedAt)
    const serverAt = account.cookieLastCheckedAt ? Date.parse(account.cookieLastCheckedAt) : 0
    const uploadedAt = account.cookieUpdatedAt ? Date.parse(account.cookieUpdatedAt) : 0
    if (!Number.isNaN(uploadedAt) && uploadedAt > testAt) {
      return accountCookieAvailable(account)
    }
    if (!Number.isNaN(testAt) && testAt >= serverAt) {
      return sessionTest.ok
    }
  }
  return accountCookieAvailable(account)
}

export function cookieStatusLabel(status: CookieHealthStatus): string {
  if (status === 'valid') return '可用'
  return '不可用'
}

export function cookieStatusTone(status: CookieHealthStatus): string {
  if (status === 'valid') return 'bg-emerald-50 text-emerald-700'
  return 'bg-rose-50 text-rose-700'
}

export function cookieAvailableLabel(available: boolean): string {
  return available ? '可用' : '不可用'
}

export function cookieAvailableTone(available: boolean): string {
  return available ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
}

export function accountCookieReason(account: LiveAccountPublic): string | null {
  if (accountCookieAvailable(account)) return null
  const msg = account.cookieLastErrorMessage?.trim() || account.syncReason?.trim()
  return msg || 'Cookie 不可用，请重新提交或点击检测查看原因'
}

/** 设置页展示：不可用时的白话原因 */
export function resolveAccountCookieFriendlyReason(
  account: LiveAccountPublic,
  sessionTest?: CookieSessionTest | null,
): string | null {
  if (resolveAccountCookieAvailable(account, sessionTest)) return null
  if (!account.hasCookie) return '尚未收到 Cookie'

  const code = account.cookieLastErrorCode?.trim() ?? ''
  const msg = account.cookieLastErrorMessage?.trim() || account.syncReason?.trim() || ''
  const combined = `${code} ${msg}`

  if (/401|403|902|登录已过期|未登录|expired/i.test(combined)) {
    return 'Cookie 已过期'
  }
  if (/cookie_missing_a1|缺少 a1|缺 a1|access-token-ark|订单同步 token|关键字段|不完整/i.test(combined)) {
    return 'Cookie 缺少关键字段'
  }
  if (account.cookieLastFailedAt || account.cookieStatus === 'invalid') {
    if (msg) return `最近校验失败：${msg}`
    return '最近校验失败'
  }
  if (msg) return msg
  return 'Cookie 尚未验证通过'
}

export function accountCanSyncOrders(account: LiveAccountPublic): boolean {
  if (!account.enabled || !account.hasCookie) return false
  if (account.canSyncOrders !== undefined) return account.canSyncOrders
  return account.cookieStatus !== 'invalid'
}

export function accountsNotSyncableForModal(payload: CookieHealthPayload | null): LiveAccountPublic[] {
  if (!payload) return []
  return payload.accounts.filter((a) => {
    if (!a.enabled) return false
    if (a.legacyShopKey && !a.officialShopKey) return false
    if (a.healthStatus) return isCookieHealthBlocking(a.healthStatus)
    return !accountCanSyncOrders(a)
  })
}

/** @deprecated 使用 accountsNotSyncableForModal */
export function invalidAccountsForModal(payload: CookieHealthPayload | null): LiveAccountPublic[] {
  return accountsNotSyncableForModal(payload)
}

export function accountSyncReason(account: LiveAccountPublic): string {
  if (account.healthStatus === 'missing') return '尚未收到 Cookie'
  if (account.syncReason?.trim()) return account.syncReason.trim()
  if (account.healthStatus === 'ok') return '校验通过'
  if (account.healthStatus && isCookieHealthBlocking(account.healthStatus)) {
    return resolveHealthFriendlyLabel(account)
  }
  if (!account.hasCookie) return '尚未收到 Cookie'
  if (accountCanSyncOrders(account)) return '校验通过'
  const msg = account.cookieLastErrorMessage?.trim()
  if (msg) return msg
  return 'Cookie 暂不可同步，请到系统设置查看原因。'
}

export function buildCookieBannerMessage(payload: CookieHealthPayload | null): string | null {
  if (!payload) return null
  if (payload.degraded && payload.errorMessage) {
    return payload.errorMessage
  }

  const enabled = payload.accounts.filter((a) => a.enabled)
  const notSyncable = enabled.filter((a) => {
    if (a.legacyShopKey && !a.officialShopKey) return false
    if (a.healthStatus) return isCookieHealthBlocking(a.healthStatus)
    return !accountCanSyncOrders(a)
  })
  const syncable = enabled.filter((a) => accountCanSyncOrders(a))
  const missing = notSyncable.filter((a) => !a.hasCookie)

  if (notSyncable.length === 0) return null

  if (notSyncable.length === 1 && syncable.length === 0) {
    const acc = notSyncable[0]!
    return `直播号「${acc.name}」${accountSyncReason(acc)}`
  }

  if (notSyncable.length === 1 && syncable.length > 0) {
    const acc = notSyncable[0]!
    return `直播号「${acc.name}」${accountSyncReason(acc)}（其余 ${syncable.length} 个可同步）`
  }

  if (syncable.length > 0) {
    return `${notSyncable.length} 个直播号 Cookie 暂不可同步，${syncable.length} 个可同步。`
  }

  if (missing.length === enabled.length) {
    return `${missing.length} 个直播号未收到 Cookie，请到系统设置更新或由机器人上传。`
  }

  return `${notSyncable.length} 个直播号 Cookie 暂不可同步，点击查看原因。`
}
