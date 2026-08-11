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

const SETTING_HISTORY_BACKFILL_DONE = 'liveReviewHistoryBackfillDone'
const SETTING_LAST_HISTORICAL_REFRESH = 'liveReviewLastHistoricalRefreshAt'
const HISTORY_BACKFILL_START = '2026-06-01'
const HISTORICAL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
const DETAIL_COOLDOWN_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAX_SESSIONS = 40
const REQUEST_GAP_MS = 180

export const LIVE_REVIEW_PRESERVE_KEYS = [
  '_liveReviewSyncedAt',
  '_liveReviewFailedAt',
  '_liveReviewNoteDetailAvailable',
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
  skipped: number
  failed: number
  notePages: number
  warnings: string[]
  mode: 'incremental' | 'history_backfill' | 'historical_refresh'
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
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

export function liveRawNeedsLiveReview(raw: Record<string, unknown>): boolean {
  if (raw._liveReviewTrafficCore != null || raw._liveReviewOverview != null) return false
  return true
}

export function liveRawShouldFetchLiveReview(raw: Record<string, unknown>, now = Date.now()): boolean {
  const failedAt = parseIsoMs(raw._liveReviewFailedAt)
  if (failedAt != null && now - failedAt < DETAIL_COOLDOWN_MS) return false
  const syncedAt = parseIsoMs(raw._liveReviewSyncedAt)
  if (syncedAt == null) return true
  // 仍在播或刚结束：允许 6h 内再刷；稳定场次跳过
  return now - syncedAt >= DETAIL_COOLDOWN_MS
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
): Promise<{ list: unknown[]; total: number; pages: number; error?: string }> {
  if (!isApiConfigured('live_replay_note')) {
    return { list: [], total: 0, pages: 0, error: 'note_api_disabled' }
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
      return { list: all, total, pages, error: res.errorMessage ?? 'note_fail' }
    }
    const part = unwrapNotes(res.data)
    total = part.total
    all.push(...part.list)
    if (all.length >= total || part.list.length === 0) break
    await sleep(REQUEST_GAP_MS)
  }
  return { list: all, total, pages }
}

export async function enrichLiveSessionsWithLiveReview(params: {
  sessionIds?: string[]
  liveAccountId?: string
  liveAccountName?: string
  syncJobId?: string | null
  context?: XhsRequestAuditContext
  maxSessions?: number
  /** 强制按给定 sessionIds，忽略窗口选择 */
  forceSessionIds?: boolean
}): Promise<EnrichLiveReviewResult> {
  const warnings: string[] = []
  let attempted = 0
  let enriched = 0
  let skipped = 0
  let failed = 0
  let notePages = 0
  const maxSessions = params.maxSessions ?? DEFAULT_MAX_SESSIONS

  const window = await resolveEnrichWindow()
  let rows: Array<{
    id: string
    liveId: string | null
    rawJson: unknown
    liveAccountId: string
    liveAccountName: string | null
    startTime: Date | null
    endTime: Date | null
  }>

  if (params.forceSessionIds && params.sessionIds?.length) {
    rows = await prisma.xhsRawLiveSession.findMany({
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
  } else {
    const startMs = startOfDayMsShanghai(window.startDate)
    const endMs = endOfDayMsShanghai(window.endDate) + 1
    rows = await prisma.xhsRawLiveSession.findMany({
      where: {
        ...(params.liveAccountId ? { liveAccountId: params.liveAccountId } : {}),
        OR: [
          { startTime: { gte: new Date(startMs), lt: new Date(endMs) } },
          { endTime: null },
        ],
      },
      orderBy: { startTime: 'desc' },
      take: maxSessions * 3,
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
    if (params.sessionIds?.length) {
      const prefer = new Set(params.sessionIds)
      rows.sort((a, b) => Number(prefer.has(b.id)) - Number(prefer.has(a.id)))
    }
  }

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
    const stillLive = row.endTime == null || row.endTime.getTime() > Date.now() - 2 * 60 * 60 * 1000
    if (!stillLive && !liveRawNeedsLiveReview(raw) && !liveRawShouldFetchLiveReview(raw)) {
      skipped++
      continue
    }
    if (!stillLive && liveRawNeedsLiveReview(raw) === false && window.mode === 'incremental') {
      // 增量模式：已有详情且非近期结束 → 跳过
      const syncedAt = parseIsoMs(raw._liveReviewSyncedAt)
      if (syncedAt != null && Date.now() - syncedAt < 7 * 24 * 60 * 60 * 1000) {
        skipped++
        continue
      }
    }

    attempted++
    const accountId = params.liveAccountId ?? row.liveAccountId
    const accountName = params.liveAccountName ?? row.liveAccountName ?? undefined
    const referer = `https://ark.xiaohongshu.com/live_review?roomId=${liveId}`
    const patch: Record<string, unknown> = {}
    const errors: string[] = []

    try {
      if (isApiConfigured('live_overview')) {
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
          if (overview) patch._liveReviewOverview = overview
        } else {
          errors.push(`overview:${ov.errorMessage || 'fail'}`)
        }
        await sleep(REQUEST_GAP_MS)
      }

      if (isApiConfigured('live_traffic_core')) {
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
            // 便于日报/流量工具直接读到 CTR / 曝光
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
          }
          if (coverList.length) patch._liveReviewCoverList = coverList
        } else {
          errors.push(`traffic:${tr.errorMessage || 'fail'}`)
        }
        await sleep(REQUEST_GAP_MS)
      }

      if (isApiConfigured('live_replay_transform')) {
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
          if (transform) patch._liveReviewTransform = transform
        } else if (tf.errorMessage && !/404/.test(tf.errorMessage)) {
          errors.push(`transform:${tf.errorMessage}`)
        }
        await sleep(REQUEST_GAP_MS)
      }

      const notes = await fetchAllNotes(liveId, accountId, accountName, params.context)
      notePages += notes.pages
      if (notes.list.length > 0) {
        patch._liveReviewNotes = notes.list
        patch._liveReviewNoteTotal = notes.total
        patch._liveReviewNoteDetailAvailable = true
      } else {
        patch._liveReviewNoteDetailAvailable = false
        if (notes.error && notes.error !== 'note_api_disabled') {
          errors.push(`note:${notes.error}`)
        }
      }

      const hasCore = patch._liveReviewOverview != null || patch._liveReviewTrafficCore != null
      if (hasCore) {
        patch._liveReviewSyncedAt = new Date().toISOString()
        delete patch._liveReviewFailedAt
        const merged = { ...raw, ...patch }
        await prisma.xhsRawLiveSession.update({
          where: { id: row.id },
          data: { rawJson: merged as Prisma.InputJsonValue },
        })
        if (params.syncJobId) {
          await prisma.xhsRawLiveSessionDetail.upsert({
            where: { sessionId: row.id },
            create: {
              sessionId: row.id,
              rawJson: JSON.stringify({
                liveId,
                overview: patch._liveReviewOverview ?? null,
                trafficCore: patch._liveReviewTrafficCore ?? null,
                coverList: patch._liveReviewCoverList ?? [],
                transform: patch._liveReviewTransform ?? null,
                notes: patch._liveReviewNotes ?? [],
                noteTotal: patch._liveReviewNoteTotal ?? 0,
                noteDetailAvailable: Boolean(patch._liveReviewNoteDetailAvailable),
                syncedAt: patch._liveReviewSyncedAt,
              }),
              syncJobId: params.syncJobId,
            },
            update: {
              rawJson: JSON.stringify({
                liveId,
                overview: patch._liveReviewOverview ?? null,
                trafficCore: patch._liveReviewTrafficCore ?? null,
                coverList: patch._liveReviewCoverList ?? [],
                transform: patch._liveReviewTransform ?? null,
                notes: patch._liveReviewNotes ?? [],
                noteTotal: patch._liveReviewNoteTotal ?? 0,
                noteDetailAvailable: Boolean(patch._liveReviewNoteDetailAvailable),
                syncedAt: patch._liveReviewSyncedAt,
              }),
              syncJobId: params.syncJobId,
            },
          })
        }
        enriched++
      } else {
        failed++
        const failPatch = {
          ...raw,
          _liveReviewFailedAt: new Date().toISOString(),
        }
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
            rawJson: {
              ...raw,
              _liveReviewFailedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        })
      } catch {
        /* ignore */
      }
    }
    await sleep(REQUEST_GAP_MS)
  }

  if (window.mode === 'history_backfill' && !params.forceSessionIds) {
    // 仅当历史窗口内不再有「缺详情」场次时才标记完成，避免单次 maxSessions 截断误关补齐
    const startMs = startOfDayMsShanghai(window.startDate)
    const endMs = endOfDayMsShanghai(window.endDate) + 1
    const remainingRows = await prisma.xhsRawLiveSession.findMany({
      where: {
        // 全局标记，不按单店过滤
        startTime: { gte: new Date(startMs), lt: new Date(endMs) },
      },
      select: { rawJson: true },
      take: 800,
    })
    const stillNeed = remainingRows.some((r) => {
      const raw = asRecord(r.rawJson) ?? {}
      return liveRawNeedsLiveReview(raw)
    })
    if (!stillNeed) {
      await setSetting(SETTING_HISTORY_BACKFILL_DONE, '1')
      await setSetting(SETTING_LAST_HISTORICAL_REFRESH, new Date().toISOString())
    }
  } else if (window.markHistoricalRefresh && !params.forceSessionIds) {
    await setSetting(SETTING_LAST_HISTORICAL_REFRESH, new Date().toISOString())
  }

  return {
    attempted,
    enriched,
    skipped,
    failed,
    notePages,
    warnings: warnings.slice(0, 20),
    mode: window.mode,
  }
}
