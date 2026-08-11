/**
 * 直播回放详情增量补齐：overview / traffic / transform / note
 * 写入 XhsRawLiveSession.rawJson（_liveReview*）+ 可选 XhsRawLiveSessionDetail
 * 挂在现有 180 分钟经营同步的场次列表保存之后，不新增定时任务。
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { logInfo, logWarn } from '../../utils/server-log'
import { getSetting, setSetting } from '../system-setting.service'
import type { XhsRequestAuditContext } from '../xhs-http.service'
import { endOfDayMsShanghai, formatDateKeyShanghai, startOfDayMsShanghai } from '../../utils/business-timezone'
import { isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'
import { REALTIME_METRIC_PRESERVE_KEYS } from './xhs-live-realtime-metric.service'
import {
  asRecord,
  countLiveReviewRemainingMissing,
  DEFAULT_DETAIL_COOLDOWN_MS,
  DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
  liveRawNeedsLiveReview,
  liveReviewPartsForSelectReason,
  liveReviewPartsFullyComplete,
  liveReviewPartsNeedingFetch,
  mergeLiveReviewDetailFields,
  mergeLiveReviewPartsStatus,
  readLiveReviewPartsStatus,
  selectLiveReviewEnrichCandidates,
  type LiveReviewPartKey,
  type LiveReviewPartsStatus,
  type LiveReviewSelectReason,
} from './xhs-live-review-enrich.util'

const SETTING_HISTORY_BACKFILL_DONE = 'liveReviewHistoryBackfillDone'
const SETTING_LAST_HISTORICAL_REFRESH = 'liveReviewLastHistoricalRefreshAt'
const HISTORY_BACKFILL_START = '2026-06-01'
const HISTORICAL_REFRESH_INTERVAL_MS = DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS
const DETAIL_COOLDOWN_MS = DEFAULT_DETAIL_COOLDOWN_MS
const DEFAULT_MAX_SESSIONS = 40
const REQUEST_GAP_MS = 180
/** 历史扫描分页，避免一次加载过大；完成判断必须扫完全部页 */
const HISTORY_SCAN_PAGE = 500

export const LIVE_REVIEW_PRESERVE_KEYS = [
  '_liveReviewSyncedAt',
  '_liveReviewFullySyncedAt',
  '_liveReviewFailedAt',
  '_liveReviewNoteDetailAvailable',
  '_liveReviewPartsStatus',
  '_liveReviewOverview',
  '_liveReviewTrafficCore',
  '_liveReviewCoverList',
  '_liveReviewTransform',
  '_liveReviewNotes',
  '_liveReviewNoteTotal',
  ...REALTIME_METRIC_PRESERVE_KEYS,
] as const

export interface EnrichLiveReviewResult {
  attempted: number
  enriched: number
  partial: number
  skipped: number
  failed: number
  notePages: number
  warnings: string[]
  mode: 'incremental' | 'history_backfill' | 'historical_refresh'
  remainingMissingCount?: number
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function unwrapOverview(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload)
  if (!root) return null
  const data = asRecord(root.data)
  if (!data) return null
  const nested = asRecord(data.data)
  return nested ?? data
}

function unwrapTraffic(payload: unknown): {
  core: Record<string, unknown> | null
  coverList: unknown[]
} {
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const core = asRecord(data?.replayTrafficCore)
  const coverList = Array.isArray(data?.coverList) ? data!.coverList : []
  return { core, coverList }
}

function unwrapTransform(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  return asRecord(data?.replayTransform)
}

function unwrapNotes(payload: unknown): { list: unknown[]; total: number } {
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const list = Array.isArray(data?.replayNoteList) ? data!.replayNoteList : []
  const total = typeof data?.total === 'number' ? data.total : list.length
  return { list, total }
}

export {
  liveRawNeedsLiveReview,
  readLiveReviewPartsStatus,
  liveReviewPartsFullyComplete,
  selectLiveReviewEnrichCandidates,
  countLiveReviewRemainingMissing,
  mergeLiveReviewDetailFields,
  shiftMonthSameDay,
  unionMapKeys,
  pickPrimaryCanonicalAnchorName,
  isCooldownRefreshDue,
  isHistoricalRefreshDue,
  resolveLiveReviewSelectReason,
  DEFAULT_DETAIL_COOLDOWN_MS,
  DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
} from './xhs-live-review-enrich.util'

/** @deprecated 使用 liveRawNeedsLiveReview；保留兼容 */
export function liveRawShouldFetchLiveReview(raw: Record<string, unknown>, now = Date.now()): boolean {
  if (!liveRawNeedsLiveReview(raw)) {
    const syncedAt = parseIsoMs(raw._liveReviewFullySyncedAt) ?? parseIsoMs(raw._liveReviewSyncedAt)
    if (syncedAt == null) return false
    return now - syncedAt >= DETAIL_COOLDOWN_MS
  }
  const failedAt = parseIsoMs(raw._liveReviewFailedAt)
  if (failedAt != null && now - failedAt < DETAIL_COOLDOWN_MS) {
    // 冷却期内：若仍有从未成功的 missing，仍允许；仅对「刚失败」节流在调用方处理
    const needing = liveReviewPartsNeedingFetch(readLiveReviewPartsStatus(raw))
    const onlyFailed = needing.every((k) => readLiveReviewPartsStatus(raw)[k] === 'failed')
    if (onlyFailed) return false
  }
  return true
}

/** 列表 upsert 时保留回放补齐字段 */
export function mergePreserveLiveReviewFields(
  existingRaw: unknown,
  incomingItem: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incomingItem }
  const prev = asRecord(existingRaw)
  if (!prev) return out
  for (const key of LIVE_REVIEW_PRESERVE_KEYS) {
    const nextVal = out[key]
    const emptyNext = nextVal == null || nextVal === ''
    if (!emptyNext) continue
    if (prev[key] !== undefined) out[key] = prev[key]
  }
  return out
}

async function resolveEnrichWindow(now = new Date()): Promise<{
  startDate: string
  endDate: string
  mode: EnrichLiveReviewResult['mode']
  markHistoricalRefresh?: boolean
}> {
  const today = formatDateKeyShanghai(now)
  const backfillDone = (await getSetting(SETTING_HISTORY_BACKFILL_DONE)) === '1'
  if (!backfillDone) {
    return {
      startDate: HISTORY_BACKFILL_START,
      endDate: today,
      mode: 'history_backfill',
    }
  }
  const lastRefresh = parseIsoMs(await getSetting(SETTING_LAST_HISTORICAL_REFRESH))
  if (lastRefresh == null || now.getTime() - lastRefresh >= HISTORICAL_REFRESH_INTERVAL_MS) {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    return {
      startDate: formatDateKeyShanghai(start),
      endDate: today,
      mode: 'historical_refresh',
      markHistoricalRefresh: true,
    }
  }
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return {
    startDate: formatDateKeyShanghai(y),
    endDate: today,
    mode: 'incremental',
  }
}

async function fetchAllNotes(
  liveId: string,
  liveAccountId: string | undefined,
  liveAccountName: string | undefined,
  context: XhsRequestAuditContext | undefined,
): Promise<{ list: unknown[]; total: number; pages: number; error?: string; ok: boolean }> {
  if (!isApiConfigured('live_replay_note')) {
    return { list: [], total: 0, pages: 0, error: 'note_api_disabled', ok: false }
  }
  const all: unknown[] = []
  let total = 0
  let pages = 0
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const res = await requestXhsApi({
      apiKey: 'live_replay_note',
      liveAccountId,
      liveAccountName,
      body: { liveId, pageNo, pageSize: 20, onlyCurSeller: true },
      context,
      refererOverride: `https://ark.xiaohongshu.com/live_review?roomId=${liveId}`,
    })
    pages++
    if (!res.ok || !res.data) {
      return { list: all, total, pages, error: res.errorMessage ?? 'note_fail', ok: false }
    }
    const part = unwrapNotes(res.data)
    total = part.total
    all.push(...part.list)
    if (all.length >= total || part.list.length === 0) break
    await sleep(REQUEST_GAP_MS)
  }
  return { list: all, total, pages, ok: true }
}

/** 分页扫完历史窗口全部场次，统计 remainingMissingCount（禁止 take 截断） */
export async function countHistoryLiveReviewRemainingMissing(params: {
  startDate: string
  endDate: string
  liveAccountId?: string
}): Promise<number> {
  const startMs = startOfDayMsShanghai(params.startDate)
  const endMs = endOfDayMsShanghai(params.endDate) + 1
  let remaining = 0
  let cursor: string | undefined
  for (;;) {
    const page = await prisma.xhsRawLiveSession.findMany({
      where: {
        ...(params.liveAccountId ? { liveAccountId: params.liveAccountId } : {}),
        startTime: { gte: new Date(startMs), lt: new Date(endMs) },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: HISTORY_SCAN_PAGE,
      select: { id: true, rawJson: true },
    })
    if (page.length === 0) break
    remaining += countLiveReviewRemainingMissing(page)
    cursor = page[page.length - 1]!.id
    if (page.length < HISTORY_SCAN_PAGE) break
  }
  return remaining
}

async function loadCandidateRows(params: {
  window: { startDate: string; endDate: string; mode: EnrichLiveReviewResult['mode'] }
  liveAccountId?: string
  sessionIds?: string[]
  forceSessionIds?: boolean
  maxSessions: number
}): Promise<
  Array<{
    id: string
    liveId: string | null
    rawJson: unknown
    liveAccountId: string
    liveAccountName: string | null
    startTime: Date | null
    endTime: Date | null
    selectReason?: LiveReviewSelectReason
  }>
> {
  if (params.forceSessionIds && params.sessionIds?.length) {
    return prisma.xhsRawLiveSession.findMany({
      where: { id: { in: [...new Set(params.sessionIds)] } },
      select: {
        id: true,
        liveId: true,
        rawJson: true,
        liveAccountId: true,
        liveAccountName: true,
        startTime: true,
        endTime: true,
      },
    })
  }

  const startMs = startOfDayMsShanghai(params.window.startDate)
  const endMs = endOfDayMsShanghai(params.window.endDate) + 1
  const select = {
    id: true,
    liveId: true,
    rawJson: true,
    liveAccountId: true,
    liveAccountName: true,
    startTime: true,
    endTime: true,
  } as const

  const todayKey = formatDateKeyShanghai(new Date())
  const yesterdayKey = formatDateKeyShanghai(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const selectOpts = {
    mode: params.window.mode,
    preferSessionIds: params.sessionIds?.length ? new Set(params.sessionIds) : undefined,
    now: Date.now(),
    todayKey,
    yesterdayKey,
    cooldownMs: DETAIL_COOLDOWN_MS,
    refreshIntervalMs: HISTORICAL_REFRESH_INTERVAL_MS,
  } as const

  // 历史补齐：按 startTime asc 分页拉取，直到凑满 maxSessions 个「缺详情」或扫完
  if (params.window.mode === 'history_backfill') {
    const collected: Array<{
      id: string
      liveId: string | null
      rawJson: unknown
      liveAccountId: string
      liveAccountName: string | null
      startTime: Date | null
      endTime: Date | null
      selectReason?: LiveReviewSelectReason
    }> = []
    let skip = 0
    const pageSize = Math.max(params.maxSessions * 3, 120)
    while (collected.length < params.maxSessions) {
      const page = await prisma.xhsRawLiveSession.findMany({
        where: {
          ...(params.liveAccountId ? { liveAccountId: params.liveAccountId } : {}),
          startTime: { gte: new Date(startMs), lt: new Date(endMs) },
        },
        orderBy: { startTime: 'asc' },
        skip,
        take: pageSize,
        select,
      })
      if (page.length === 0) break
      const batch = selectLiveReviewEnrichCandidates(page, {
        ...selectOpts,
        maxSessions: params.maxSessions - collected.length,
      })
      collected.push(...batch)
      skip += page.length
      if (page.length < pageSize) break
    }
    return collected.slice(0, params.maxSessions)
  }

  // 增量 / 历史刷新：窗口内场次交给选择器（含 full 到期刷新），禁止只留 missing
  const rows = await prisma.xhsRawLiveSession.findMany({
    where: {
      ...(params.liveAccountId ? { liveAccountId: params.liveAccountId } : {}),
      OR: [
        { startTime: { gte: new Date(startMs), lt: new Date(endMs) } },
        { endTime: null },
      ],
    },
    orderBy: { startTime: 'desc' },
    select,
  })

  return selectLiveReviewEnrichCandidates(rows, {
    ...selectOpts,
    maxSessions: params.maxSessions,
  })
}

export async function enrichLiveSessionsWithLiveReview(params: {
  sessionIds?: string[]
  liveAccountId?: string
  liveAccountName?: string
  syncJobId?: string | null
  context?: XhsRequestAuditContext
  maxSessions?: number
  forceSessionIds?: boolean
}): Promise<EnrichLiveReviewResult> {
  const warnings: string[] = []
  let attempted = 0
  let enriched = 0
  let partial = 0
  let skipped = 0
  let failed = 0
  let notePages = 0
  const maxSessions = params.maxSessions ?? DEFAULT_MAX_SESSIONS

  const window = await resolveEnrichWindow()
  const rows = await loadCandidateRows({
    window,
    liveAccountId: params.liveAccountId,
    sessionIds: params.sessionIds,
    forceSessionIds: params.forceSessionIds,
    maxSessions,
  })

  logInfo(
    '直播回放补齐',
    `mode=${window.mode} window=${window.startDate}~${window.endDate} candidates=${rows.length} max=${maxSessions}`,
  )

  for (const row of rows) {
    if (attempted >= maxSessions) break
    const liveId = (row.liveId ?? '').trim()
    if (!liveId) {
      skipped++
      continue
    }
    const raw = asRecord(row.rawJson) ?? {}
    const prevStatus = readLiveReviewPartsStatus(raw)
    const selectReason: LiveReviewSelectReason =
      row.selectReason ??
      (liveRawNeedsLiveReview(raw) ? 'missing_or_failed' : 'cooldown_refresh')
    const needing = liveReviewPartsForSelectReason(selectReason, prevStatus)
    if (needing.length === 0 && !params.forceSessionIds) {
      skipped++
      continue
    }

    attempted++
    const accountId = params.liveAccountId ?? row.liveAccountId
    const accountName = params.liveAccountName ?? row.liveAccountName ?? undefined
    const referer = `https://ark.xiaohongshu.com/live_review?roomId=${liveId}`
    const patch: Record<string, unknown> = {}
    const statusPatch: Partial<LiveReviewPartsStatus> = {}
    const errors: string[] = []
    const needSet = new Set<LiveReviewPartKey>(
      params.forceSessionIds && needing.length === 0
        ? (['overview', 'traffic', 'transform', 'note'] as LiveReviewPartKey[])
        : needing,
    )

    try {
      if (needSet.has('overview') && isApiConfigured('live_overview')) {
        const ov = await requestXhsApi({
          apiKey: 'live_overview',
          query: { liveId, onlyCurSeller: 'true' },
          liveAccountId: accountId,
          liveAccountName: accountName,
          context: params.context,
          refererOverride: referer,
        })
        if (ov.ok && ov.data) {
          const overview = unwrapOverview(ov.data)
          if (overview) {
            patch._liveReviewOverview = overview
            statusPatch.overview = 'ok'
          } else {
            statusPatch.overview = 'failed'
            errors.push('overview:empty')
          }
        } else {
          statusPatch.overview = 'failed'
          errors.push(`overview:${ov.errorMessage || 'fail'}`)
        }
        await sleep(REQUEST_GAP_MS)
      }

      if (needSet.has('traffic') && isApiConfigured('live_traffic_core')) {
        const tr = await requestXhsApi({
          apiKey: 'live_traffic_core',
          query: { liveId, onlyCurSeller: 'true' },
          liveAccountId: accountId,
          liveAccountName: accountName,
          context: params.context,
          refererOverride: referer,
        })
        if (tr.ok && tr.data) {
          const { core, coverList } = unwrapTraffic(tr.data)
          if (core) {
            patch._liveReviewTrafficCore = core
            statusPatch.traffic = 'ok'
            if (core.liveCtr != null) {
              patch.liveCtr = core.liveCtr
              patch.live_ctr = core.liveCtr
            }
            if (core.liveImpressionCnt != null) {
              patch.liveTotalImpressionCnt = core.liveImpressionCnt
              patch.live_total_impression_cnt = core.liveImpressionCnt
            }
            if (core.joinUv != null) patch.serverLiveViewUserNum = core.joinUv
            if (core.viewerDurationAvg != null) {
              patch.avgViewDuration = core.viewerDurationAvg
              patch.viewer_duration_avg = core.viewerDurationAvg
            }
            if (core.viewDealRate != null) patch.viewPayRate = core.viewDealRate
            if (core.liveNoteNum != null) patch.liveNoteNum = core.liveNoteNum
          } else {
            statusPatch.traffic = 'failed'
            errors.push('traffic:empty')
          }
          if (coverList.length) patch._liveReviewCoverList = coverList
        } else {
          statusPatch.traffic = 'failed'
          errors.push(`traffic:${tr.errorMessage || 'fail'}`)
        }
        await sleep(REQUEST_GAP_MS)
      }

      if (needSet.has('transform') && isApiConfigured('live_replay_transform')) {
        const tf = await requestXhsApi({
          apiKey: 'live_replay_transform',
          body: { liveId, onlyCurSeller: true },
          liveAccountId: accountId,
          liveAccountName: accountName,
          context: params.context,
          refererOverride: referer,
        })
        if (tf.ok && tf.data) {
          const transform = unwrapTransform(tf.data)
          if (transform) {
            patch._liveReviewTransform = transform
            statusPatch.transform = 'ok'
          } else {
            statusPatch.transform = 'empty_ok'
          }
        } else if (tf.errorMessage && /404/.test(tf.errorMessage)) {
          statusPatch.transform = 'empty_ok'
        } else {
          statusPatch.transform = 'failed'
          if (tf.errorMessage) errors.push(`transform:${tf.errorMessage}`)
        }
        await sleep(REQUEST_GAP_MS)
      }

      if (needSet.has('note')) {
        const notes = await fetchAllNotes(liveId, accountId, accountName, params.context)
        notePages += notes.pages
        if (notes.ok) {
          if (notes.list.length > 0) {
            patch._liveReviewNotes = notes.list
            patch._liveReviewNoteTotal = notes.total
            patch._liveReviewNoteDetailAvailable = true
            statusPatch.note = 'ok'
          } else {
            // 成功但空：标记 empty_ok，不抹掉历史 notes
            patch._liveReviewNoteTotal = notes.total
            patch._liveReviewNoteDetailAvailable = notes.total > 0
            statusPatch.note = 'empty_ok'
          }
        } else if (notes.error === 'note_api_disabled') {
          statusPatch.note = 'failed'
          errors.push('note:disabled')
        } else {
          statusPatch.note = 'failed'
          errors.push(`note:${notes.error || 'fail'}`)
        }
      }

      const nextStatus = mergeLiveReviewPartsStatus(prevStatus, statusPatch)
      patch._liveReviewPartsStatus = nextStatus

      const anySuccess = Object.values(statusPatch).some((s) => s === 'ok' || s === 'empty_ok')
      const anyFailed = Object.values(statusPatch).some((s) => s === 'failed')
      const full = liveReviewPartsFullyComplete(nextStatus)

      if (anySuccess || full) {
        patch._liveReviewSyncedAt = new Date().toISOString()
        if (full) {
          patch._liveReviewFullySyncedAt = patch._liveReviewSyncedAt
          delete patch._liveReviewFailedAt
        } else if (anyFailed) {
          patch._liveReviewFailedAt = new Date().toISOString()
        }

        const merged = mergeLiveReviewDetailFields(raw, patch)
        await prisma.xhsRawLiveSession.update({
          where: { id: row.id },
          data: { rawJson: merged as Prisma.InputJsonValue },
        })

        if (params.syncJobId) {
          const existingDetail = await prisma.xhsRawLiveSessionDetail.findUnique({
            where: { sessionId: row.id },
            select: { rawJson: true },
          })
          let prevDetail: Record<string, unknown> = {}
          if (existingDetail?.rawJson) {
            try {
              prevDetail = JSON.parse(existingDetail.rawJson) as Record<string, unknown>
            } catch {
              prevDetail = {}
            }
          }
          const detailPayload = mergeLiveReviewDetailFields(prevDetail, {
            liveId,
            overview: (merged._liveReviewOverview as unknown) ?? null,
            trafficCore: (merged._liveReviewTrafficCore as unknown) ?? null,
            coverList: (merged._liveReviewCoverList as unknown) ?? [],
            transform: (merged._liveReviewTransform as unknown) ?? null,
            notes: (merged._liveReviewNotes as unknown) ?? [],
            noteTotal: merged._liveReviewNoteTotal ?? 0,
            noteDetailAvailable: Boolean(merged._liveReviewNoteDetailAvailable),
            partsStatus: nextStatus,
            syncedAt: merged._liveReviewSyncedAt,
            fullySyncedAt: merged._liveReviewFullySyncedAt ?? null,
          })
          await prisma.xhsRawLiveSessionDetail.upsert({
            where: { sessionId: row.id },
            create: {
              sessionId: row.id,
              rawJson: JSON.stringify(detailPayload),
              syncJobId: params.syncJobId,
            },
            update: {
              rawJson: JSON.stringify(detailPayload),
              syncJobId: params.syncJobId,
            },
          })
        }

        if (full) enriched++
        else {
          partial++
          warnings.push(`${liveId}:partial:${liveReviewPartsNeedingFetch(nextStatus).join(',')}`)
        }
      } else {
        failed++
        const failPatch = mergeLiveReviewDetailFields(raw, {
          ...raw,
          _liveReviewPartsStatus: nextStatus,
          _liveReviewFailedAt: new Date().toISOString(),
        })
        await prisma.xhsRawLiveSession.update({
          where: { id: row.id },
          data: { rawJson: failPatch as Prisma.InputJsonValue },
        })
        warnings.push(`${liveId}:${errors.join('|') || 'empty'}`)
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`${liveId}:error:${msg}`.slice(0, 180))
      logWarn('直播回放补齐', `场次 ${liveId} 失败：${msg.slice(0, 120)}`)
      try {
        await prisma.xhsRawLiveSession.update({
          where: { id: row.id },
          data: {
            rawJson: mergeLiveReviewDetailFields(raw, {
              ...raw,
              _liveReviewFailedAt: new Date().toISOString(),
            }) as Prisma.InputJsonValue,
          },
        })
      } catch {
        /* ignore */
      }
    }
    await sleep(REQUEST_GAP_MS)
  }

  let remainingMissingCount: number | undefined
  if (window.mode === 'history_backfill' && !params.forceSessionIds) {
    // 全局全量扫描；禁止 take:800 截断后误判完成
    remainingMissingCount = await countHistoryLiveReviewRemainingMissing({
      startDate: window.startDate,
      endDate: window.endDate,
    })
    if (remainingMissingCount === 0) {
      await setSetting(SETTING_HISTORY_BACKFILL_DONE, '1')
      await setSetting(SETTING_LAST_HISTORICAL_REFRESH, new Date().toISOString())
    }
  } else if (window.markHistoricalRefresh && !params.forceSessionIds) {
    await setSetting(SETTING_LAST_HISTORICAL_REFRESH, new Date().toISOString())
  }

  return {
    attempted,
    enriched,
    partial,
    skipped,
    failed,
    notePages,
    warnings: warnings.slice(0, 20),
    mode: window.mode,
    remainingMissingCount,
  }
}
