import { prisma } from '../../lib/prisma'
import { Prisma } from '@prisma/client'
import type {
  SyncLiveSessionListOnlyParams,
  SyncLiveSessionListOnlyResult,
} from './xhs-live-sync.service'
import {
  buildLiveSessionListBody,
  extractLiveBlock,
  stableLiveSessionId,
} from './xhs-live-sync.service'
import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'
import { mergePreserveRealtimeMetricFields } from './xhs-live-realtime-metric.service'

const DEFAULT_MAX_PAGES = 100

function extractFieldValue(item: Record<string, unknown>, fieldName: string): unknown {
  const field = item[fieldName]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value !== undefined && f.value !== null && String(f.value).trim() !== '') {
      return f.value
    }
  }
  return item[fieldName]
}

function pickLiveField(item: Record<string, unknown>, fieldName: string): string | null {
  const value = extractFieldValue(item, fieldName)
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function parseLiveDateTime(raw: unknown): Date | null {
  if (raw == null) return null
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? null : d
}

async function saveLiveSessionItem(
  item: Record<string, unknown>,
  syncJobId: string | null | undefined,
  liveAccountId: string,
  liveAccountName: string,
): Promise<{ saved: boolean; created: boolean }> {
  const baseId = stableLiveSessionId(item)
  const id = `${liveAccountId}::${baseId}`
  const existing = await prisma.xhsRawLiveSession.findUnique({
    where: { id },
    select: { id: true, rawJson: true },
  })
  const liveId = pickLiveField(item, 'liveId')
  const liveName = pickLiveField(item, 'liveName')
  const anchorName =
    pickLiveField(item, 'nickName') ?? pickLiveField(item, 'userId')
  const startTime = parseLiveDateTime(extractFieldValue(item, 'liveStartTime'))
  const endTime = parseLiveDateTime(extractFieldValue(item, 'liveEndTime'))
  // 保留已补齐的大屏指标，避免 sellerLiveDetailData 整表覆盖冲掉 live_ctr / 60s
  const mergedRaw = mergePreserveRealtimeMetricFields(existing?.rawJson, item)
  const rawJson = mergedRaw as Prisma.InputJsonValue

  await prisma.xhsRawLiveSession.upsert({
    where: { id },
    create: {
      id,
      liveId,
      liveName,
      liveAccountId,
      liveAccountName,
      startTime,
      endTime,
      anchorName,
      rawJson,
      syncJobId: syncJobId ?? null,
    },
    update: {
      liveId,
      liveName,
      liveAccountId,
      liveAccountName,
      startTime,
      endTime,
      anchorName,
      rawJson,
      syncJobId: syncJobId ?? null,
    },
  })
  return { saved: true, created: !existing }
}

export async function syncLiveSessionListOnlyWithSave(
  params: SyncLiveSessionListOnlyParams,
): Promise<SyncLiveSessionListOnlyResult> {
  if (!isApiConfigured('live_session_list')) {
    return {
      total: 0,
      itemCount: 0,
      pageCount: 0,
      savedCount: 0,
      firstLiveId: null,
      firstLiveName: null,
      warnings: ['直播场次列表接口未配置'],
    }
  }

  const def = getApiDefinition('live_session_list')
  const pageSize = params.pageSize ?? def.pageSize
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES

  const warnings: string[] = []
  let page = 1
  let pageCount = 0
  let itemCount = 0
  let savedCount = 0
  let createdCount = 0
  let updatedCount = 0
  let total = 0
  let firstLiveId: string | null = null
  let firstLiveName: string | null = null
  let totalPageEstimate: number | null = null
  const syncStarted = Date.now()
  const savedSessionIds: string[] = []

  const liveAccountId = params.liveAccountId ?? 'legacy'
  const liveAccountName = params.liveAccountName ?? '未知直播号'
  const accountCtx = {
    accountName: liveAccountName,
    liveAccountId: params.liveAccountId,
    accountIndex: params.accountIndex,
    accountTotal: params.accountTotal,
  }
  const dateRange = `${params.startDate} 00:00:00 ~ ${params.endDate} 23:59:59`
  const {
    logLiveSyncComplete,
    logLiveSyncFailed,
    logLiveSyncStart,
    logXhsAccountAuthFailed,
    logXhsAccountRateLimited,
  } = await import('../../utils/sync-cmd-log')

  logLiveSyncStart(accountCtx, dateRange)

  while (page <= maxPages) {
    await params.progress?.beforeRequest('live_session_list', page, totalPageEstimate)

    const res = await requestXhsApi({
      apiKey: 'live_session_list',
      liveAccountId: params.liveAccountId,
      liveAccountName,
      body: buildLiveSessionListBody(params.startDate, params.endDate, page, pageSize),
      context: params.context,
      accountIndex: params.accountIndex,
      accountTotal: params.accountTotal,
    })
    pageCount++
    const ok = Boolean(res.ok && res.data)
    await params.progress?.afterRequest(ok)

    if (!ok) {
      warnings.push(res.errorMessage ?? `第 ${page} 页请求失败`)
      if (res.authError) {
        const reason =
          res.httpStatus === 429 || res.httpStatus === 406
            ? '触发限流'
            : res.httpStatus === 401 || res.httpStatus === 403
              ? `Cookie 失效或权限不足（HTTP ${res.httpStatus}）`
              : (res.errorMessage ?? '接口失败')
        logLiveSyncFailed(accountCtx, reason)
        if (res.authError.stopRound) {
          if (res.httpStatus === 429 || res.httpStatus === 406) {
            logXhsAccountRateLimited(accountCtx)
          } else {
            logXhsAccountAuthFailed(accountCtx, res.httpStatus)
          }
        }
        return {
          total,
          itemCount,
          pageCount,
          savedCount,
          firstLiveId,
          firstLiveName,
          warnings,
          authFailed: true,
          syncStopped: Boolean(res.authError.stopRound),
        }
      }
      logLiveSyncFailed(accountCtx, res.errorMessage ?? `第 ${page} 页请求失败`)
      break
    }

    const block = extractLiveBlock(res.data)
    total = block.total || total
    if (total > 0) {
      totalPageEstimate = Math.ceil(total / pageSize)
    }

    const pageSessionIds: string[] = []
    for (const item of block.items) {
      if (!firstLiveId) firstLiveId = pickLiveField(item, 'liveId')
      if (!firstLiveName) firstLiveName = pickLiveField(item, 'liveName')
      itemCount++
      const saved = await saveLiveSessionItem(
        item,
        params.syncJobId,
        liveAccountId,
        liveAccountName,
      )
      if (saved.saved) {
        savedCount++
        if (saved.created) createdCount++
        else updatedCount++
        const baseId = stableLiveSessionId(item)
        pageSessionIds.push(`${liveAccountId}::${baseId}`)
      }
    }
    savedSessionIds.push(...pageSessionIds)

    if (block.items.length === 0) break
    if (total > 0 && page * pageSize >= total) break
    if (block.items.length < pageSize) break

    page++
  }

  if (page > maxPages && total > page * pageSize) {
    warnings.push(`已达到最大页数保护 ${maxPages}，可能未拉取完整数据`)
  }

  if (savedSessionIds.length > 0) {
    try {
      const { enrichLiveSessionsWithRealtimeMetric } = await import(
        './xhs-live-realtime-metric.service'
      )
      const enrich = await enrichLiveSessionsWithRealtimeMetric({
        sessionIds: [...new Set(savedSessionIds)],
        liveAccountId: params.liveAccountId,
        liveAccountName,
        context: params.context,
        maxRequests: 80,
        invalidateCache: true,
        // 同步本批尽量打满；冷却留给日报二次补齐
        respectCooldown: false,
        requestGapMs: 120,
      })
      warnings.push(
        `大屏指标补齐：成功 ${enrich.enriched} / 跳过 ${enrich.skipped} / 失败 ${enrich.failed} / 请求 ${enrich.attempted}`,
      )
      warnings.push(...enrich.warnings.slice(0, 8))
    } catch (err) {
      warnings.push(
        `大屏指标补齐异常：${err instanceof Error ? err.message : String(err)}`.slice(0, 160),
      )
    }
  }

  const durationSec = (Date.now() - syncStarted) / 1000
  logLiveSyncComplete({
    ctx: accountCtx,
    apiRows: itemCount,
    saved: savedCount,
    durationSec,
  })

  return {
    total,
    itemCount,
    pageCount,
    savedCount,
    firstLiveId,
    firstLiveName,
    warnings,
  }
}
