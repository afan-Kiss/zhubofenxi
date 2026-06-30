export type CookieStatusLevel = 'ok' | 'warning' | 'error'

export interface CookieSyncDerived {
  status: string
  reason: string
  canSyncOrders: boolean
  statusLevel: CookieStatusLevel
}

export interface ShopCookieStatusSummary {
  total: number
  canSyncCount: number
  cannotSyncCount: number
  missingCookieCount: number
  missingA1Count: number
  missingArkCount: number
  expiredCount: number
}

function includesAuthExpired(code: string | null | undefined, msg: string | null | undefined): boolean {
  const c = code?.trim() ?? ''
  const m = msg?.trim() ?? ''
  if (c === '401' || c === '403' || c === '902') return true
  return /401|403|902|登录已过期|未登录/.test(m)
}

function includesMissingA1(code: string | null | undefined, msg: string | null | undefined): boolean {
  const c = code?.trim() ?? ''
  const m = msg?.trim() ?? ''
  return c === 'cookie_missing_a1' || /缺少 a1|缺 a1|不完整.*a1/i.test(m)
}

function includesMissingArk(code: string | null | undefined, msg: string | null | undefined): boolean {
  const c = code?.trim() ?? ''
  const m = msg?.trim() ?? ''
  return c === 'cookie_missing_access_token' || /access-token-ark|订单同步 token/i.test(m)
}

export function deriveStatusLevel(
  canSyncOrders: boolean,
  hasCookie: boolean,
  status: string,
): CookieStatusLevel {
  if (!hasCookie) return 'error'
  if (canSyncOrders) return 'ok'
  if (status === 'uploaded' || status === 'unknown' || status === 'pending_validate') return 'warning'
  return 'error'
}

export function deriveCookieSyncState(
  row: {
    cookieEncrypted: string | null
    cookieStatus: string
    cookieLastCheckedAt: Date | null
    cookieLastErrorMessage: string | null
    cookieLastErrorCode: string | null
    updatedAt: Date
  } | null,
): CookieSyncDerived {
  if (!row?.cookieEncrypted?.trim()) {
    return {
      status: 'missing',
      reason: '未收到 Cookie',
      canSyncOrders: false,
      statusLevel: 'error',
    }
  }

  const st = row.cookieStatus || 'unknown'
  const code = row.cookieLastErrorCode
  const msg = row.cookieLastErrorMessage?.trim() ?? ''

  if (st === 'valid') {
    return {
      status: 'valid',
      reason: 'Cookie 已验证有效，可同步订单',
      canSyncOrders: true,
      statusLevel: 'ok',
    }
  }

  if (st === 'unknown') {
    return {
      status: 'uploaded',
      reason: '已收到 Cookie，可尝试同步',
      canSyncOrders: true,
      statusLevel: 'ok',
    }
  }

  if (includesMissingA1(code, msg)) {
    return {
      status: 'invalid',
      reason: 'Cookie 不完整，缺少 a1，请重新提交完整 Cookie。',
      canSyncOrders: false,
      statusLevel: 'error',
    }
  }

  if (includesAuthExpired(code, msg)) {
    return {
      status: 'invalid',
      reason: '小红书登录已过期，请重新登录后提交 Cookie。',
      canSyncOrders: false,
      statusLevel: 'error',
    }
  }

  if (includesMissingArk(code, msg)) {
    return {
      status: 'invalid',
      reason:
        '已收到 Cookie，但缺少订单同步 token，请在对应店铺打开订单/数据页面后重新提交 Cookie。',
      canSyncOrders: false,
      statusLevel: 'error',
    }
  }

  if (st === 'suspected') {
    return {
      status: 'suspected',
      reason: msg || '已收到 Cookie，但平台接口疑似异常',
      canSyncOrders: false,
      statusLevel: 'error',
    }
  }

  if (st === 'invalid') {
    return {
      status: 'invalid',
      reason: msg || '已收到 Cookie，但验证失败',
      canSyncOrders: false,
      statusLevel: 'error',
    }
  }

  return {
    status: st,
    reason: 'Cookie 状态待确认',
    canSyncOrders: false,
    statusLevel: 'error',
  }
}

export function buildShopCookieSummary(
  shops: Array<{
    hasCookie: boolean
    canSyncOrders: boolean
    reason: string
    status: string
    cookieLastErrorCode?: string | null
  }>,
): ShopCookieStatusSummary {
  let canSyncCount = 0
  let cannotSyncCount = 0
  let missingCookieCount = 0
  let missingA1Count = 0
  let missingArkCount = 0
  let expiredCount = 0

  for (const shop of shops) {
    if (!shop.hasCookie) {
      missingCookieCount += 1
      cannotSyncCount += 1
      continue
    }
    if (shop.canSyncOrders) {
      canSyncCount += 1
      continue
    }
    cannotSyncCount += 1
    const code = shop.cookieLastErrorCode ?? null
    const msg = shop.reason
    if (includesMissingA1(code, msg)) missingA1Count += 1
    else if (includesMissingArk(code, msg)) missingArkCount += 1
    else if (includesAuthExpired(code, msg)) expiredCount += 1
  }

  return {
    total: shops.length,
    canSyncCount,
    cannotSyncCount,
    missingCookieCount,
    missingA1Count,
    missingArkCount,
    expiredCount,
  }
}
