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
  /** 面向用户的 Cookie 同步说明 */
  syncReason?: string
  statusLevel?: 'ok' | 'warning' | 'error'
  cookieDisplayStatus?: string
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
  return {
    id: row.id,
    name: row.displayName?.trim() || row.platformName,
    enabled: row.enabled,
    hasCookie,
    cookie,
    cookieText: cookie,
    cookiePreview,
    cookieUpdatedAt: hasCookie ? row.updatedAt.toISOString() : null,
    cookieStatus: derived.canSyncOrders ? 'valid' : 'invalid',
    cookieLastCheckedAt: row.cookieLastCheckedAt?.toISOString() ?? null,
    cookieLastSuccessAt: row.cookieLastSuccessAt?.toISOString() ?? null,
    cookieLastFailedAt: row.cookieLastFailedAt?.toISOString() ?? null,
    cookieLastErrorCode: row.cookieLastErrorCode,
    cookieLastErrorMessage: derived.canSyncOrders ? null : derived.reason || row.cookieLastErrorMessage,
    cookieLastFailedApi: row.cookieLastFailedApi,
    affectedBusinessSync: row.affectedBusinessSync,
    lastSyncSuccessAt: row.lastSyncSuccessAt?.toISOString() ?? null,
    canSyncOrders: derived.canSyncOrders,
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
  return rows.map((r) => toPublicView(r, { includeCookie: true }))
}

export async function getLiveAccountCookiePlaintext(id: string): Promise<string> {
  const row = await prisma.platformCredential.findUnique({ where: { id } })
  if (!row?.cookieEncrypted?.trim()) {
    throw new Error('尚未配置 Cookie')
  }
  const plain = resolveStoredCookiePlaintext(row.cookieEncrypted)
  if (!plain) {
    throw new Error('Cookie 解密失败，请重新保存 Cookie')
  }
  return plain
}

export async function listEnabledLiveAccountsWithCookie(): Promise<
  Array<{ id: string; name: string; platformName: string }>
> {
  const rows = await prisma.platformCredential.findMany({
    where: { enabled: true, NOT: { cookieEncrypted: '' } },
    orderBy: { createdAt: 'asc' },
  })
  if (rows.length === 0) {
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
  return rows.map((r) => ({
    id: r.id,
    name: r.displayName?.trim() || r.platformName,
    platformName: r.platformName,
  }))
}

export async function getLiveAccountById(id: string) {
  return prisma.platformCredential.findUnique({ where: { id } })
}

export async function getDecryptedCookieByAccountId(accountId: string): Promise<string> {
  const row = await prisma.platformCredential.findUnique({ where: { id: accountId } })
  const displayName = row?.displayName?.trim() || row?.platformName
  const { resolveLiveAccountCookie } = await import('./qianfan-cookie-resolver.service')
  const resolved = await resolveLiveAccountCookie(accountId, displayName)
  if (resolved) return resolved
  if (!row?.cookieEncrypted?.trim()) {
    throw new Error('尚未配置该直播号 Cookie')
  }
  return decryptText(row.cookieEncrypted)
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

export async function createLiveAccount(input: {
  name: string
  cookie: string
  enabled?: boolean
  updatedBy: string
}): Promise<{ account: LiveAccountPublicView; testResult: Awaited<ReturnType<typeof testLiveAccountCookie>> }> {
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
      cookieStatus: 'unknown',
    },
  })

  const testResult = await testLiveAccountCookie(row.id)
  const refreshed = await prisma.platformCredential.findUnique({ where: { id: row.id } })
  return { account: toPublicView(refreshed!, { includeCookie: true }), testResult }
}

export async function updateLiveAccountCookie(
  id: string,
  cookie: string,
  updatedBy: string,
): Promise<{ account: LiveAccountPublicView; testResult: Awaited<ReturnType<typeof testLiveAccountCookie>> }> {
  const trimmed = cookie.trim()
  if (!trimmed) throw new Error('Cookie 不能为空')
  await prisma.platformCredential.update({
    where: { id },
    data: {
      cookieEncrypted: encryptText(trimmed),
      updatedBy,
      cookieStatus: 'unknown',
      affectedBusinessSync: false,
    },
  })
  const testResult = await testLiveAccountCookie(id)
  const refreshed = await prisma.platformCredential.findUnique({ where: { id } })
  return { account: toPublicView(refreshed!, { includeCookie: true }), testResult }
}

/** 仅保存 Cookie，不立即做平台验证（机器人上传链路用） */
export async function persistLiveAccountCookieOnly(
  id: string,
  cookie: string,
  updatedBy: string,
): Promise<LiveAccountPublicView> {
  const trimmed = cookie.trim()
  if (!trimmed) throw new Error('Cookie 不能为空')
  const row = await prisma.platformCredential.update({
    where: { id },
    data: {
      cookieEncrypted: encryptText(trimmed),
      updatedBy,
      cookieStatus: 'unknown',
      affectedBusinessSync: false,
    },
  })
  return toPublicView(row, { includeCookie: false })
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

export async function testLiveAccountCookie(id: string): Promise<{
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

export async function getCookieHealthPayload(): Promise<{
  accounts: LiveAccountPublicView[]
  summary: CookieHealthSummary
}> {
  const accounts = await listLiveAccountsPublic()
  const { getShopCookieStatusPayload } = await import('./shop-cookie-upload.service')
  const shopPayload = await getShopCookieStatusPayload()
  const shopByAccountId = new Map(
    shopPayload.shops.filter((s) => s.accountId).map((s) => [s.accountId!, s]),
  )

  const rows = await prisma.platformCredential.findMany({ orderBy: { createdAt: 'asc' } })
  const rowById = new Map(rows.map((r) => [r.id, r]))

  const enrichedAccounts = accounts.map((account) => {
    const shop = shopByAccountId.get(account.id)
    if (shop) {
      return {
        ...account,
        canSyncOrders: shop.canSyncOrders,
        syncReason: shop.reason,
        cookieStatus: (shop.canSyncOrders ? 'valid' : 'invalid') as CookieHealthStatus,
        cookieLastErrorMessage: shop.canSyncOrders ? null : shop.reason,
        statusLevel: deriveStatusLevel(shop.canSyncOrders, shop.hasCookie, shop.status),
        cookieDisplayStatus: shop.status,
      }
    }
    const row = rowById.get(account.id)
    const derived = deriveCookieSyncState(
      row
        ? {
            cookieEncrypted: row.cookieEncrypted,
            cookieStatus: row.cookieStatus,
            cookieLastCheckedAt: row.cookieLastCheckedAt,
            cookieLastErrorMessage: row.cookieLastErrorMessage,
            cookieLastErrorCode: row.cookieLastErrorCode,
            updatedAt: row.updatedAt,
          }
        : null,
    )
    return {
      ...account,
      canSyncOrders: derived.canSyncOrders,
      syncReason: derived.reason,
      statusLevel: derived.statusLevel,
      cookieDisplayStatus: derived.status,
    }
  })

  const enabled = enrichedAccounts.filter((a) => a.enabled)
  const shopSummary = buildShopCookieSummary(
    shopPayload.shops.map((s) => {
      const row = s.accountId ? rowById.get(s.accountId) : undefined
      return {
        hasCookie: s.hasCookie,
        canSyncOrders: s.canSyncOrders,
        reason: s.reason,
        status: s.status,
        cookieLastErrorCode: row?.cookieLastErrorCode ?? null,
      }
    }),
  )
  const summary: CookieHealthSummary = {
    enabledCount: enabled.length,
    validCount: enabled.filter((a) => a.canSyncOrders === true).length,
    invalidCount: enabled.filter((a) => a.canSyncOrders !== true).length,
    suspectedCount: 0,
    unknownCount: enabled.filter((a) => a.canSyncOrders !== true && a.cookieStatus === 'unknown').length,
    canSyncCount: enabled.filter((a) => a.canSyncOrders === true).length,
    cannotSyncCount: enabled.filter((a) => a.canSyncOrders === false).length,
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
