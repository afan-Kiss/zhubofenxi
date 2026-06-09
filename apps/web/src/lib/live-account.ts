export type CookieHealthStatus = 'valid' | 'invalid' | 'suspected' | 'unknown'

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
}

export interface CookieHealthSummary {
  enabledCount: number
  validCount: number
  invalidCount: number
  suspectedCount: number
  unknownCount: number
}

export interface CookieHealthPayload {
  ok?: boolean
  accounts: LiveAccountPublic[]
  summary: CookieHealthSummary
}

export function cookieStatusLabel(status: CookieHealthStatus): string {
  switch (status) {
    case 'valid':
      return '正常'
    case 'invalid':
      return '已失效'
    case 'suspected':
      return '疑似异常'
    default:
      return '未检测'
  }
}

export function cookieStatusTone(status: CookieHealthStatus): string {
  switch (status) {
    case 'valid':
      return 'bg-emerald-50 text-emerald-700'
    case 'invalid':
      return 'bg-rose-50 text-rose-700'
    case 'suspected':
      return 'bg-amber-50 text-amber-800'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

export function buildCookieBannerMessage(payload: CookieHealthPayload | null): string | null {
  if (!payload) return null
  const invalid = payload.accounts.filter((a) => a.enabled && a.cookieStatus === 'invalid')
  const suspected = payload.accounts.filter((a) => a.enabled && a.cookieStatus === 'suspected')
  if (invalid.length === 1) {
    return `直播号「${invalid[0]!.name}」Cookie 已失效，请到系统设置更新 Cookie。`
  }
  if (invalid.length > 1) {
    return `有 ${invalid.length} 个直播号 Cookie 异常，部分数据可能未更新，请到系统设置查看。`
  }
  if (suspected.length === 1) {
    return `有 1 个直播号 Cookie 疑似异常，建议测试 Cookie 状态。`
  }
  if (suspected.length > 1) {
    return `有 ${suspected.length} 个直播号 Cookie 疑似异常，建议测试 Cookie 状态。`
  }
  return null
}

export function invalidAccountsForModal(payload: CookieHealthPayload | null): LiveAccountPublic[] {
  if (!payload) return []
  return payload.accounts.filter((a) => a.enabled && a.cookieStatus === 'invalid')
}
