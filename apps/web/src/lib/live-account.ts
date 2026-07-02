export type CookieHealthStatus = 'valid' | 'invalid' | 'suspected' | 'unknown'
export type CookieStatusLevel = 'ok' | 'warning' | 'error'

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
}

export interface CookieSessionTest {
  ok: boolean
  checkedAt: string
  status?: 'valid' | 'invalid' | 'limited' | 'unknown' | 'testing'
}

export function accountCookieAvailable(account: LiveAccountPublic): boolean {
  if (!account.hasCookie) return false
  // 以最近一次 Cookie 检测结果为准（与「检测」按钮口径一致）
  if (account.cookieLastCheckedAt) {
    return account.cookieStatus === 'valid'
  }
  return accountCanSyncOrders(account)
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

export function accountCanSyncOrders(account: LiveAccountPublic): boolean {
  if (account.canSyncOrders !== undefined) return account.canSyncOrders
  if (!account.enabled || !account.hasCookie) return false
  return account.cookieStatus === 'valid'
}

export function accountsNotSyncableForModal(payload: CookieHealthPayload | null): LiveAccountPublic[] {
  if (!payload) return []
  return payload.accounts.filter((a) => a.enabled && !accountCanSyncOrders(a))
}

/** @deprecated 使用 accountsNotSyncableForModal */
export function invalidAccountsForModal(payload: CookieHealthPayload | null): LiveAccountPublic[] {
  return accountsNotSyncableForModal(payload)
}

export function accountSyncReason(account: LiveAccountPublic): string {
  if (account.syncReason?.trim()) return account.syncReason.trim()
  if (!account.hasCookie) return '未收到 Cookie'
  if (accountCanSyncOrders(account)) return '已收到 Cookie，可尝试同步'
  const msg = account.cookieLastErrorMessage?.trim()
  if (msg) return msg
  return 'Cookie 暂不可同步，请到系统设置查看原因。'
}

export function buildCookieBannerMessage(payload: CookieHealthPayload | null): string | null {
  if (!payload) return null

  const enabled = payload.accounts.filter((a) => a.enabled)
  const notSyncable = enabled.filter((a) => !accountCanSyncOrders(a))
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
