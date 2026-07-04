import { prisma } from '../lib/prisma'
import { encryptText, decryptText } from '../utils/crypto'
import type { CookieHealthStatus } from '../utils/xhs-auth.util'
import { resolveDateRange } from '../utils/date-range'
import { requestXhsApi } from './xhs-api-sync/xhs-api-client.service'
import { buildOrderListBody } from './xhs-api-sync/xhs-order-sync.service'
import { classifyXhsErrorMessage } from '../utils/xhs-auth.util'
import {
  deriveCookieSyncState,
  deriveStatusLevel,
  buildShopCookieSummary,
} from '../utils/cookie-sync-status.util'
import { probeQualityBadcaseSignForAccount } from './quality-badcase-sign.service'
import {
  isOfficialShopPlatformName,
  isLegacyDuplicateShopAccountRow,
  resolveShopKeyFromAccountName,
  deleteAllLegacyDuplicateShopAccounts,
  type DeleteLegacyDuplicateShopAccountsResult,
} from './official-shop-account.service'
import {
  getAllShopCookieHealth,
  isCookieHealthBlocking,
  clearShopCookieHealthCache,
  type ShopCookieHealthResult,
  type ShopCookieHealthStatus,
} from './shop-cookie-health.service'
import {
  resolveCookieUploadSource,
  type CookieUploadSource,
} from '../utils/cookie-upload-source.util'

const DEFAULT_PLATFORM = 'xiaohongshu'

export interface LiveAccountPublicView {
  id: string
  name: string
  enabled: boolean
  hasCookie: boolean
  /** 完整 Cookie（仅系统设置页列表返回） */
  cookie: string | null
  /** 与 cookie 相同，供前端显式读取 */
  cookieText: string | null
  cookiePreview: string | null
  cookieUpdatedAt: string | null
  /** 最近一次 Cookie 写入操作者（用户 id 或 shop-cookie-upload） */
  cookieUpdatedBy: string | null
  /** 手动上传 / API 上传 */
  cookieUploadSource: CookieUploadSource
  cookieStatus: CookieHealthStatus
  cookieLastCheckedAt: string | null
  cookieLastSuccessAt: string | null
  cookieLastFailedAt: string | null
  cookieLastErrorCode: string | null
  cookieLastErrorMessage: string | null
  cookieLastFailedApi: string | null
  affectedBusinessSync: boolean
  lastSyncSuccessAt: string | null
  /** 是否可同步订单（与 shop-cookies/status 口径一致） */
  canSyncOrders?: boolean
  /** 四店官方 shopKey（platformName === shopKey 时有值） */
  officialShopKey?: string | null
  /** 历史重复账号：别名匹配四店但非官方 platformName */
  legacyShopKey?: string | null
  /** 面向用户的 Cookie 同步说明 */
  syncReason?: string
  statusLevel?: 'ok' | 'warning' | 'error'
  cookieDisplayStatus?: string
  /** 统一健康状态（四店官方账号） */
  healthStatus?: string
}

export interface CookieHealthSummary {
  enabledCount: number
  validCount: number
  invalidCount: number
  suspectedCount: number
  unknownCount: number
  canSyncCount: number
  cannotSyncCount: number
  missingCookieCount: number
  missingA1Count: number
  missingArkCount: number
  expiredCount: number
}

function maskCookiePreview(cookie: string): string {
  const trimmed = cookie.trim()
  if (trimmed.length <= 16) return '已保存'
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`
}

/** 从库中读取 Cookie 明文（支持加密存储与历史明文存储） */
function resolveStoredCookiePlaintext(cookieEncrypted: string): string | null {
  const trimmed = cookieEncrypted.trim()
  if (!trimmed) return null
  try {
    const plain = decryptText(trimmed).trim()
    return plain || null
  } catch {
    if (trimmed.includes(';') || trimmed.includes('=')) {
      return trimmed
    }
    return null
  }
}

function toPublicView(
  row: {
    id: string
    displayName: string
    platformName: string
    cookieEncrypted: string
    enabled: boolean
    updatedAt: Date
    cookieStatus: string
    cookieLastCheckedAt: Date | null
    cookieLastSuccessAt: Date | null
    cookieLastFailedAt: Date | null
    cookieLastErrorCode: string | null
    cookieLastErrorMessage: string | null
    cookieLastFailedApi: string | null
    affectedBusinessSync: boolean
    lastSyncSuccessAt: Date | null
    updatedBy: string | null
  },
  options?: { includeCookie?: boolean },
): LiveAccountPublicView {
  const hasCookie = Boolean(row.cookieEncrypted?.trim())
  let cookiePreview: string | null = null
  let cookie: string | null = null
  const plain = hasCookie ? resolveStoredCookiePlaintext(row.cookieEncrypted) : null
  if (plain) {
    cookiePreview = maskCookiePreview(plain)
    if (options?.includeCookie) {
      cookie = plain
    }
  } else if (hasCookie) {
    cookiePreview = '已保存'
  }
  const derived = deriveCookieSyncState(
    {
      cookieEncrypted: row.cookieEncrypted,
      cookieStatus: row.cookieStatus,
      cookieLastCheckedAt: row.cookieLastCheckedAt,
      cookieLastErrorMessage: row.cookieLastErrorMessage,
      cookieLastErrorCode: row.cookieLastErrorCode,
      updatedAt: row.updatedAt,
    },
    { plainCookie: plain },
  )
  const officialShopKey = isOfficialShopPlatformName(row.platformName) ? row.platformName : null
  const legacyShopKey =
    !officialShopKey && resolveShopKeyFromAccountName(row.displayName?.trim() || row.platformName)
      ? resolveShopKeyFromAccountName(row.displayName?.trim() || row.platformName)
      : null
  return {
    id: row.id,
    name: row.displayName?.trim() || row.platformName,
    enabled: row.enabled,
    hasCookie,
    cookie,
    cookieText: cookie,
    cookiePreview,
    cookieUpdatedAt: hasCookie ? row.updatedAt.toISOString() : null,
    cookieUpdatedBy: hasCookie ? row.updatedBy ?? null : null,
    cookieUploadSource: hasCookie ? resolveCookieUploadSource(row.updatedBy) : 'unknown',
    cookieStatus: (row.cookieStatus as CookieHealthStatus) || 'unknown',
    cookieLastCheckedAt: row.cookieLastCheckedAt?.toISOString() ?? null,
    cookieLastSuccessAt: row.cookieLastSuccessAt?.toISOString() ?? null,
    cookieLastFailedAt: row.cookieLastFailedAt?.toISOString() ?? null,
    cookieLastErrorCode: row.cookieLastErrorCode,
    cookieLastErrorMessage: derived.canSyncOrders ? null : derived.reason || row.cookieLastErrorMessage,
    cookieLastFailedApi: row.cookieLastFailedApi,
    affectedBusinessSync: row.affectedBusinessSync,
    lastSyncSuccessAt: row.lastSyncSuccessAt?.toISOString() ?? null,
    canSyncOrders: derived.canSyncOrders,
    officialShopKey,
    legacyShopKey,
    syncReason: derived.reason,
    statusLevel: derived.statusLevel,
    cookieDisplayStatus: derived.status,
  }
}

export async function ensureDefaultLiveAccount(): Promise<void> {
  const existing = await prisma.platformCredential.findUnique({
    where: { platformName: DEFAULT_PLATFORM },
  })
  if (existing) {
    if (!existing.displayName?.trim()) {
      await prisma.platformCredential.update({
        where: { id: existing.id },
        data: { displayName: existing.remark?.trim() || '默认' },
      })
    }
    await prisma.xhsRawOrder.updateMany({
      where: { liveAccountId: 'legacy' },
      data: {
        liveAccountId: existing.id,
        liveAccountName: existing.displayName?.trim() || '默认',
      },
    })
    await prisma.xhsRawLiveSession.updateMany({
      where: { liveAccountId: 'legacy' },
      data: {
        liveAccountId: existing.id,
        liveAccountName: existing.displayName?.trim() || '默认',
      },
    })
    return
  }

  const row = await prisma.platformCredential.findFirst({
    where: { NOT: { cookieEncrypted: '' } },
    orderBy: { createdAt: 'asc' },
  })
  if (row) return

  await prisma.platformCredential.create({
    data: {
      platformName: DEFAULT_PLATFORM,
      displayName: '默认',
      cookieEncrypted: '',
      enabled: true,
      cookieStatus: 'unknown',
    },
  })
}

export async function listLiveAccountsPublic(): Promise<LiveAccountPublicView[]> {
  const rows = await prisma.platformCredential.findMany({ orderBy: { createdAt: 'asc' } })
  return rows.map((r) => toPublicView(r))
}

/** 系统设置页：返回完整 Cookie 供查看与复制 */
export async function listLiveAccountsForSettings(): Promise<LiveAccountPublicView[]> {
  const rows = await prisma.platformCredential.findMany({ orderBy: { createdAt: 'asc' } })
  const shopHealthList = await getAllShopCookieHealth({ fresh: false })
  const healthByShopKey = new Map(shopHealthList.map((h) => [h.shopCode, h]))

  return rows.map((r) => {
    if (isOfficialShopPlatformName(r.platformName)) {
      const health = healthByShopKey.get(r.platformName)
      if (health) {
        return mapShopHealthToPublicView(health, r, { includeCookie: true })
      }
    }
    return toPublicView(r, { includeCookie: true })
  })
}

export async function getLiveAccountCookiePlaintext(id: string): Promise<string> {
  return getStoredLiveAccountCookiePlaintext(id)
}

/** 唯一 Cookie 来源：系统设置 / 外部上传写入 PlatformCredential 的记录 */
export async function getStoredLiveAccountCookiePlaintext(accountId: string): Promise<string> {
  const row = await prisma.platformCredential.findUnique({ where: { id: accountId } })
  if (!row?.cookieEncrypted?.trim()) {
    throw new Error('尚未配置 Cookie')
  }
  const plain = resolveStoredCookiePlaintext(row.cookieEncrypted)
  if (!plain) {
    throw new Error('Cookie 解密失败，请重新保存 Cookie')
  }
  return plain
}

export async function getDecryptedCookieByAccountId(accountId: string): Promise<string> {
  return getStoredLiveAccountCookiePlaintext(accountId)
}

export async function listEnabledLiveAccountsWithCookie(): Promise<
  Array<{ id: string; name: string; platformName: string }>
> {
  const { listActiveLiveAccountsWithCookie } = await import('./official-shop-account.service')
  const active = await listActiveLiveAccountsWithCookie()
  if (active.length > 0) return active

  const fallback = await prisma.platformCredential.findFirst({
    where: { platformName: DEFAULT_PLATFORM },
  })
  if (fallback?.cookieEncrypted) {
    return [
      {
        id: fallback.id,
        name: fallback.displayName?.trim() || '默认',
        platformName: fallback.platformName,
      },
    ]
  }
  return []
}

export async function getLiveAccountById(id: string) {
  return prisma.platformCredential.findUnique({ where: { id } })
}

function slugFromName(name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fff-]/g, '')
      .slice(0, 24) || 'live'
  return `${base}-${Date.now().toString(36)}`
}

/** 保存 Cookie，不做平台接口探测（上传 / 粘贴即视为可用） */
export async function persistLiveAccountCookieOnly(
  id: string,
  cookie: string,
  updatedBy: string,
  options?: { includeCookie?: boolean },
): Promise<LiveAccountPublicView> {
  const trimmed = cookie.trim()
  if (!trimmed) throw new Error('Cookie 不能为空')
  const row = await prisma.platformCredential.update({
    where: { id },
    data: {
      cookieEncrypted: encryptText(trimmed),
      updatedBy,
      cookieStatus: 'valid',
      cookieLastCheckedAt: null,
      cookieLastSuccessAt: null,
      cookieLastFailedAt: null,
      cookieLastErrorCode: null,
      cookieLastErrorMessage: null,
      cookieLastFailedApi: null,
      affectedBusinessSync: false,
    },
  })
  if (isOfficialShopPlatformName(row.platformName)) {
    clearShopCookieHealthCache(row.platformName)
  }
  return toPublicView(row, { includeCookie: options?.includeCookie })
}

export async function createLiveAccount(input: {
  name: string
  cookie: string
  enabled?: boolean
  updatedBy: string
}): Promise<LiveAccountPublicView> {
  const name = input.name.trim()
  const cookie = input.cookie.trim()
  if (!name) throw new Error('请填写直播号名称')
  if (!cookie) throw new Error('请填写 Cookie')

  const row = await prisma.platformCredential.create({
    data: {
      platformName: slugFromName(name),
      displayName: name,
      cookieEncrypted: encryptText(cookie),
      enabled: input.enabled !== false,
      updatedBy: input.updatedBy,
      cookieStatus: 'valid',
    },
  })

  return toPublicView(row, { includeCookie: true })
}

export async function updateLiveAccountCookie(
  id: string,
  cookie: string,
  updatedBy: string,
): Promise<LiveAccountPublicView> {
  return persistLiveAccountCookieOnly(id, cookie, updatedBy, { includeCookie: true })
}

export async function updateLiveAccountMeta(
  id: string,
  input: { name?: string; enabled?: boolean },
  options?: { includeCookie?: boolean },
): Promise<LiveAccountPublicView> {
  const data: { displayName?: string; enabled?: boolean } = {}
  if (input.name != null) {
    const name = input.name.trim()
    if (!name) throw new Error('直播号名称不能为空')
    data.displayName = name
  }
  if (input.enabled !== undefined) data.enabled = input.enabled
  const row = await prisma.platformCredential.update({ where: { id }, data })
  if (data.displayName) {
    await prisma.xhsRawOrder.updateMany({
      where: { liveAccountId: id },
      data: { liveAccountName: data.displayName },
    })
    await prisma.xhsRawLiveSession.updateMany({
      where: { liveAccountId: id },
      data: { liveAccountName: data.displayName },
    })
  }
  return toPublicView(row, { includeCookie: options?.includeCookie })
}

export async function deleteLiveAccount(id: string): Promise<void> {
  const count = await prisma.platformCredential.count()
  if (count <= 1) throw new Error('至少保留一个直播号配置')
  const [orderCount, liveCount] = await Promise.all([
    prisma.xhsRawOrder.count({ where: { liveAccountId: id } }),
    prisma.xhsRawLiveSession.count({ where: { liveAccountId: id } }),
  ])
  if (orderCount > 0 || liveCount > 0) {
    throw new Error(
      '该直播号已有历史订单或直播数据，无法直接删除。建议点击「停用」；历史订单仍会保留在经营分析中。',
    )
  }
  await prisma.platformCredential.delete({ where: { id } })
}

export async function deleteLegacyDuplicateLiveAccounts(): Promise<DeleteLegacyDuplicateShopAccountsResult> {
  const result = await deleteAllLegacyDuplicateShopAccounts()
  clearShopCookieHealthCache()
  await refreshLiveAccountRowMapperContext()
  return result
}

export async function markCookieCheckResult(
  id: string,
  result: {
    status: CookieHealthStatus
    errorCode?: string | null
    errorMessage?: string | null
    failedApi?: string | null
    affectedBusinessSync?: boolean
  },
): Promise<void> {
  const now = new Date()
  const isSuccess = result.status === 'valid'
  await prisma.platformCredential.update({
    where: { id },
    data: {
      cookieStatus: result.status,
      cookieLastCheckedAt: now,
      cookieLastSuccessAt: isSuccess ? now : null,
      cookieLastFailedAt: isSuccess ? null : now,
      cookieLastErrorCode: isSuccess ? null : result.errorCode ?? null,
      cookieLastErrorMessage: isSuccess ? null : result.errorMessage ?? null,
      cookieLastFailedApi: isSuccess ? null : result.failedApi ?? null,
      affectedBusinessSync: result.affectedBusinessSync ?? !isSuccess,
    },
  })
  const row = await prisma.platformCredential.findUnique({
    where: { id },
    select: { platformName: true },
  })
  if (row && isOfficialShopPlatformName(row.platformName)) {
    clearShopCookieHealthCache(row.platformName as import('../config/good-review-shops.constants').GoodReviewShopKey)
  } else {
    clearShopCookieHealthCache()
  }
}

/** 经营同步成功：只更新最近同步时间，不覆盖 Cookie 检测结果（同步可能走千帆，与库内 Cookie 不是同一份） */
export async function markLiveAccountSyncSuccess(id: string): Promise<void> {
  const now = new Date()
  await prisma.platformCredential.update({
    where: { id },
    data: {
      lastSyncSuccessAt: now,
      affectedBusinessSync: false,
    },
  })
}

/** Cookie 真实探测冷却：5 分钟内不重复请求平台接口 */
const COOKIE_TEST_COOLDOWN_MS = 5 * 60 * 1000

function isPlatformRequestThrottled(message: string | null | undefined): boolean {
  if (!message) return false
  return /冷却|熔断|频率/i.test(message)
}

function buildTestResultFromDbRow(account: {
  cookieStatus: string
  cookieLastCheckedAt: Date | null
  cookieLastErrorCode: string | null
  cookieLastErrorMessage: string | null
  cookieLastFailedApi: string | null
}, extra?: {
  fromCooldown?: boolean
  cooldownRemainingSeconds?: number
  message?: string
}): {
  ok: boolean
  cookieStatus: CookieHealthStatus
  message: string
  errorCode?: string
  commonApiOk: boolean
  commonApiError?: string | null
  qualitySignOk: boolean
  qualitySignError?: string | null
  qualityApiOk: boolean
  qualityApiError?: string | null
  fromCooldown?: boolean
  cooldownRemainingSeconds?: number
  checkedAt?: string
} {
  const status = (account.cookieStatus as CookieHealthStatus) || 'unknown'
  const checkedAt = account.cookieLastCheckedAt?.toISOString()
  const errMsg = account.cookieLastErrorMessage?.trim() || undefined
  const failedApi = account.cookieLastFailedApi
  const commonOk = status === 'valid'
  return {
    ok: status === 'valid',
    cookieStatus: status,
    message: extra?.message ?? errMsg ?? (status === 'valid' ? 'Cookie 可用' : 'Cookie 检测未通过'),
    errorCode: account.cookieLastErrorCode ?? undefined,
    commonApiOk: commonOk && failedApi !== 'order_list',
    commonApiError: commonOk ? null : errMsg ?? null,
    qualitySignOk: commonOk && failedApi !== 'quality_sign',
    qualitySignError: commonOk ? null : errMsg ?? null,
    qualityApiOk: commonOk && failedApi !== 'quality_badcase',
    qualityApiError: commonOk ? null : errMsg ?? null,
    fromCooldown: extra?.fromCooldown,
    cooldownRemainingSeconds: extra?.cooldownRemainingSeconds,
    checkedAt,
  }
}

export async function testLiveAccountCookie(
  id: string,
  options?: { force?: boolean },
): Promise<{
  ok: boolean
  cookieStatus: CookieHealthStatus
  message: string
  errorCode?: string
  commonApiOk: boolean
  commonApiError?: string | null
  qualitySignOk: boolean
  qualitySignError?: string | null
  qualityApiOk: boolean
  qualityApiError?: string | null
  fromCooldown?: boolean
  cooldownRemainingSeconds?: number
  checkedAt?: string
}> {
  const account = await prisma.platformCredential.findUnique({ where: { id } })
  if (!account?.cookieEncrypted?.trim()) {
    await markCookieCheckResult(id, {
      status: 'invalid',
      errorCode: 'no_cookie',
      errorMessage: '尚未配置 Cookie',
      failedApi: 'order_list',
    })
    return {
      ok: false,
      cookieStatus: 'invalid',
      message: '尚未配置 Cookie',
      errorCode: 'no_cookie',
      commonApiOk: false,
      commonApiError: '尚未配置 Cookie',
      qualitySignOk: false,
      qualitySignError: '尚未配置 Cookie',
      qualityApiOk: false,
      qualityApiError: '尚未配置 Cookie',
    }
  }

  const cookieUpdatedAfterCheck =
    account.cookieLastCheckedAt != null &&
    Math.abs(account.updatedAt.getTime() - account.cookieLastCheckedAt.getTime()) >= 2000 &&
    account.updatedAt.getTime() > account.cookieLastCheckedAt.getTime()

  if (!options?.force && account.cookieLastCheckedAt && !cookieUpdatedAfterCheck) {
    const elapsed = Date.now() - account.cookieLastCheckedAt.getTime()
    if (elapsed < COOKIE_TEST_COOLDOWN_MS) {
      const remaining = COOKIE_TEST_COOLDOWN_MS - elapsed
      return buildTestResultFromDbRow(account, {
        fromCooldown: true,
        cooldownRemainingSeconds: Math.ceil(remaining / 1000),
        message: '刚检测过，冷却期内不重复请求平台接口',
      })
    }
  }

  const cookie = decryptText(account.cookieEncrypted)
  const accountName = account.displayName?.trim() || account.platformName
  const qualityProbe = await probeQualityBadcaseSignForAccount({
    accountName,
    liveAccountId: id,
    cookie,
  })

  const range = resolveDateRange('today')
  const res = await requestXhsApi({
    apiKey: 'order_list',
    liveAccountId: id,
    body: buildOrderListBody(1, 1, range.startTimeMs, range.endTimeMs),
  })

  if (res.ok) {
    const signIssue = !qualityProbe.signOk
    const qualityApiIssue = qualityProbe.signOk && !qualityProbe.qualityApiOk
    const message = qualityProbe.signOk
      ? qualityProbe.qualityApiOk
        ? 'Cookie 测试成功（订单接口 + 品退签名 + 品退接口）'
        : 'Cookie 订单接口与品退签名正常，品退接口请求未通过'
      : 'Cookie 订单接口可用，但品退签名失败（请检查 Python / xhshow）'

    if (signIssue || qualityApiIssue) {
      const status: CookieHealthStatus = 'invalid'
      const errorCode = signIssue
        ? qualityProbe.errorReason ?? 'quality_sign_failed'
        : qualityProbe.errorReason ?? 'quality_api_failed'
      const errorMessage = signIssue
        ? qualityProbe.signError ?? message
        : qualityProbe.qualityApiError ?? message
      const failedApi = signIssue ? 'quality_sign' : 'quality_badcase'
      await markCookieCheckResult(id, {
        status,
        errorCode,
        errorMessage,
        failedApi,
        affectedBusinessSync: signIssue,
      })
      return {
        ok: false,
        cookieStatus: status,
        message,
        errorCode,
        commonApiOk: true,
        commonApiError: null,
        qualitySignOk: qualityProbe.signOk,
        qualitySignError: qualityProbe.signError,
        qualityApiOk: qualityProbe.qualityApiOk,
        qualityApiError: qualityProbe.qualityApiError,
      }
    }

    await markCookieCheckResult(id, { status: 'valid' })
    return {
      ok: true,
      cookieStatus: 'valid',
      message,
      commonApiOk: true,
      qualitySignOk: qualityProbe.signOk,
      qualitySignError: qualityProbe.signError,
      qualityApiOk: qualityProbe.qualityApiOk,
      qualityApiError: qualityProbe.qualityApiError,
    }
  }

  const classified = classifyXhsErrorMessage(res.errorMessage ?? '')
  if (isPlatformRequestThrottled(res.errorMessage)) {
    return buildTestResultFromDbRow(account, {
      message: res.errorMessage ?? '平台接口冷却中，沿用上次检测结果',
    })
  }
  const status: CookieHealthStatus =
    classified.cookieStatus ?? (classified.suspected ? 'suspected' : 'invalid')
  await markCookieCheckResult(id, {
    status,
    errorCode: classified.errorCode ?? 'test_failed',
    errorMessage: res.errorMessage ?? classified.errorMessage,
    failedApi: 'order_list',
  })
  return {
    ok: false,
    cookieStatus: status,
    message: res.errorMessage ?? 'Cookie 测试失败',
    errorCode: classified.errorCode ?? 'test_failed',
    commonApiOk: false,
    commonApiError: res.errorMessage ?? 'Cookie 测试失败',
    qualitySignOk: qualityProbe.signOk,
    qualitySignError: qualityProbe.signError,
    qualityApiOk: qualityProbe.qualityApiOk,
    qualityApiError: qualityProbe.qualityApiError,
  }
}

function mapShopHealthToPublicView(
  health: ShopCookieHealthResult,
  row: {
    id: string
    displayName: string
    platformName: string
    cookieEncrypted: string
    enabled: boolean
    updatedAt: Date
    cookieStatus: string
    cookieLastCheckedAt: Date | null
    cookieLastSuccessAt: Date | null
    cookieLastFailedAt: Date | null
    cookieLastErrorCode: string | null
    cookieLastErrorMessage: string | null
    cookieLastFailedApi: string | null
    affectedBusinessSync: boolean
    lastSyncSuccessAt: Date | null
    updatedBy: string | null
  } | null,
  options?: { includeCookie?: boolean },
): LiveAccountPublicView {
  const rowCookieStatus = (row?.cookieStatus as CookieHealthStatus) || 'unknown'
  const trustUploaded = rowCookieStatus === 'valid' && health.hasCookie

  let cookieStatus: CookieHealthStatus =
    trustUploaded || health.status === 'ok'
      ? 'valid'
      : health.status === 'incomplete' || health.status === 'invalid'
        ? 'invalid'
        : health.status === 'unknown'
          ? rowCookieStatus
          : 'invalid'
  let healthStatus = trustUploaded ? 'ok' : health.status
  let healthOk = trustUploaded || health.ok
  let syncReason = trustUploaded
    ? row?.cookieLastCheckedAt
      ? '校验通过'
      : '已收到 Cookie'
    : health.reason
  if (!trustUploaded && health.status === 'unknown' && rowCookieStatus === 'invalid') {
    healthStatus = 'invalid'
    healthOk = false
    cookieStatus = 'invalid'
    syncReason =
      row?.cookieLastErrorMessage?.trim() ||
      health.reason ||
      '登录状态校验失败，可能需要重新推送 Cookie'
  }
  const statusLevel: 'ok' | 'warning' | 'error' =
    healthOk ? 'ok' : healthStatus === 'unknown' ? 'warning' : 'error'

  let cookiePreview: string | null = null
  let cookie: string | null = null
  let cookieText: string | null = null
  if (health.hasCookie && row?.cookieEncrypted?.trim()) {
    const plain = resolveStoredCookiePlaintext(row.cookieEncrypted)
    if (plain) {
      cookiePreview = maskCookiePreview(plain)
      if (options?.includeCookie) {
        cookie = plain
        cookieText = plain
      }
    } else {
      cookiePreview = '已保存'
    }
  }

  return {
    id: health.accountId ?? row?.id ?? health.shopCode,
    name: health.shopName,
    enabled: row?.enabled ?? true,
    hasCookie: health.hasCookie,
    cookie,
    cookieText,
    cookiePreview,
    cookieUpdatedAt: health.updatedAt,
    cookieUpdatedBy: health.hasCookie ? row?.updatedBy ?? null : null,
    cookieUploadSource: health.hasCookie
      ? resolveCookieUploadSource(row?.updatedBy)
      : 'unknown',
    cookieStatus,
    cookieLastCheckedAt: row?.cookieLastCheckedAt?.toISOString() ?? health.checkedAt,
    cookieLastSuccessAt: row?.cookieLastSuccessAt?.toISOString() ?? null,
    cookieLastFailedAt: healthOk ? null : health.checkedAt,
    cookieLastErrorCode: healthOk ? null : row?.cookieLastErrorCode ?? null,
    cookieLastErrorMessage: healthOk ? null : syncReason,
    cookieLastFailedApi: health.failedEndpoint,
    affectedBusinessSync: row?.affectedBusinessSync ?? !healthOk,
    lastSyncSuccessAt: row?.lastSyncSuccessAt?.toISOString() ?? null,
    canSyncOrders: healthOk,
    officialShopKey: health.shopCode,
    legacyShopKey: null,
    syncReason,
    statusLevel,
    cookieDisplayStatus: healthStatus,
    healthStatus,
  }
}

export async function getCookieHealthPayload(options?: {
  fresh?: boolean
}): Promise<{
  accounts: LiveAccountPublicView[]
  summary: CookieHealthSummary
}> {
  const shopHealthList = await getAllShopCookieHealth(options)
  const rows = await prisma.platformCredential.findMany({ orderBy: { createdAt: 'asc' } })
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const rowByShopKey = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (isOfficialShopPlatformName(row.platformName)) {
      rowByShopKey.set(row.platformName, row)
    }
  }

  const enrichedAccounts: LiveAccountPublicView[] = []

  for (const health of shopHealthList) {
    const row = health.accountId
      ? rowById.get(health.accountId) ?? rowByShopKey.get(health.shopCode) ?? null
      : rowByShopKey.get(health.shopCode) ?? null
    enrichedAccounts.push(mapShopHealthToPublicView(health, row))
  }

  for (const row of rows) {
    if (isOfficialShopPlatformName(row.platformName)) continue
    if (isLegacyDuplicateShopAccountRow(row)) continue
    enrichedAccounts.push(toPublicView(row))
  }

  const enabled = enrichedAccounts.filter((a) => a.enabled)
  const shopSummary = buildShopCookieSummary(
    shopHealthList.map((h) => ({
      hasCookie: h.hasCookie,
      canSyncOrders: h.ok,
      reason: h.reason,
      status: h.status,
      cookieLastErrorCode: null,
    })),
  )
  const summary: CookieHealthSummary = {
    enabledCount: enabled.length,
    validCount: enabled.filter((a) => a.canSyncOrders === true).length,
    invalidCount: enabled.filter(
      (a) => a.healthStatus && isCookieHealthBlocking(a.healthStatus as ShopCookieHealthStatus),
    ).length,
    suspectedCount: 0,
    unknownCount: enabled.filter((a) => a.healthStatus === 'unknown').length,
    canSyncCount: enabled.filter((a) => a.canSyncOrders === true).length,
    cannotSyncCount: enabled.filter(
      (a) => a.healthStatus && isCookieHealthBlocking(a.healthStatus as ShopCookieHealthStatus),
    ).length,
    missingCookieCount: shopSummary.missingCookieCount,
    missingA1Count: shopSummary.missingA1Count,
    missingArkCount: shopSummary.missingArkCount,
    expiredCount: shopSummary.expiredCount,
  }
  return { accounts: enrichedAccounts, summary }
}

export async function getLastAuthError(): Promise<{
  liveAccountId: string
  liveAccountName: string
  api: string
  errorCode: string
  message: string
} | null> {
  const row = await prisma.platformCredential.findFirst({
    where: {
      enabled: true,
      cookieStatus: { in: ['invalid', 'suspected'] },
      cookieLastFailedAt: { not: null },
    },
    orderBy: { cookieLastFailedAt: 'desc' },
  })
  if (!row?.cookieLastFailedAt) return null
  return {
    liveAccountId: row.id,
    liveAccountName: row.displayName?.trim() || row.platformName,
    api: row.cookieLastFailedApi ?? 'unknown',
    errorCode: row.cookieLastErrorCode ?? 'auth_expired',
    message: row.cookieLastErrorMessage ?? 'Cookie 已失效',
  }
}

export interface LiveAccountRowMapperContext {
  nameById: Map<string, string>
  singleFallbackName: string | null
  singleFallbackId: string | null
}

let cachedRowMapperContext: LiveAccountRowMapperContext | null = null

export async function refreshLiveAccountRowMapperContext(): Promise<LiveAccountRowMapperContext> {
  const rows = await prisma.platformCredential.findMany({
    select: { id: true, displayName: true, platformName: true, enabled: true },
    orderBy: { createdAt: 'asc' },
  })
  const nameById = new Map<string, string>()
  for (const r of rows) {
    nameById.set(r.id, r.displayName?.trim() || r.platformName || '未知直播号')
  }
  const enabled = rows.filter((r) => r.enabled)
  const single = enabled.length === 1 ? enabled[0]! : rows.length === 1 ? rows[0]! : null
  cachedRowMapperContext = {
    nameById,
    singleFallbackName: single ? single.displayName?.trim() || single.platformName : null,
    singleFallbackId: single?.id ?? null,
  }
  return cachedRowMapperContext
}

export function getLiveAccountRowMapperContext(): LiveAccountRowMapperContext | null {
  return cachedRowMapperContext
}

export function resolveLiveAccountDisplayName(
  liveAccountId: string | undefined,
  liveAccountName: string | undefined,
  ctx: LiveAccountRowMapperContext | null,
): { liveAccountId?: string; liveAccountName: string } {
  const id = liveAccountId?.trim()
  const name = liveAccountName?.trim()
  if (name) return { liveAccountId: id, liveAccountName: name }
  if (id) {
    const looked = ctx?.nameById.get(id)
    if (looked) return { liveAccountId: id, liveAccountName: looked }
    return { liveAccountId: id, liveAccountName: '未知直播号' }
  }
  if (ctx?.singleFallbackName) {
    return {
      liveAccountId: ctx.singleFallbackId ?? undefined,
      liveAccountName: ctx.singleFallbackName,
    }
  }
  return { liveAccountName: '未知直播号' }
}
