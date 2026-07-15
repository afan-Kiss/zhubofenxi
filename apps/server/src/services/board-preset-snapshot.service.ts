import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataDir } from '../config/env'
import {
  buildBusinessCacheKey,
  shouldRetainBusinessBoardCache,
  type BusinessBoardCacheEntry,
} from './business-cache.service'
import type { BusinessDataGenerationSnapshot } from './business-data-generation.service'
import { resolveBusinessRange, type BusinessRangePreset } from '../utils/business-range'
import { logInfo, logWarn } from '../utils/server-log'

export const BOARD_SNAPSHOT_PAYLOAD_VERSION = 'wave4-v1'

/** 由调用方传入当前 BUSINESS_CACHE_FINGERPRINT，避免循环依赖硬编码漂移 */
let currentFingerprintResolver: () => string = () => 'unknown'

export function setBoardSnapshotFingerprintResolver(fn: () => string): void {
  currentFingerprintResolver = fn
}

function currentFingerprint(): string {
  return currentFingerprintResolver()
}

export interface BoardPresetSnapshotRecord {
  cacheKey: string
  preset: string
  startDate: string
  endDate: string
  summary: Record<string, unknown>
  anchorPerformanceSummary: Record<string, unknown>
  enrichedAnchorLeaderboard: Array<Record<string, unknown>>
  blacklistedBuyerIds: string[]
  orderCount: number
  lastBuiltAt: string
  sourceSyncJobId: string | null
  savedAt: string
  /** Wave4 */
  businessCacheFingerprint?: string
  dataGeneration?: BusinessDataGenerationSnapshot | null
  afterSalesCompletenessSummary?: Record<string, unknown> | null
  overviewMeta?: Record<string, unknown> | null
  payloadVersion?: string
  buildDurationMs?: number
}

const SNAPSHOT_DIR = () => path.join(getDataDir(), 'board-snapshots')

function snapshotPath(cacheKey: string): string {
  const safe = cacheKey.replace(/[|]/g, '_')
  return path.join(SNAPSHOT_DIR(), `${safe}.json`)
}

export function isBoardSnapshotStructurallyUsable(
  snap: BoardPresetSnapshotRecord | null | undefined,
): boolean {
  if (!snap?.summary || typeof snap.summary !== 'object') return false
  return true
}

/** 业务指纹兼容才视为可信秒开（版本升级后旧快照不可直接当真） */
export function isBoardSnapshotFingerprintCompatible(
  snap: BoardPresetSnapshotRecord | null | undefined,
): boolean {
  if (!isBoardSnapshotStructurallyUsable(snap)) return false
  const fp = (snap!.businessCacheFingerprint ?? '').trim()
  if (!fp) return false
  return fp === currentFingerprint()
}

export async function persistBoardPresetSnapshot(input: {
  preset: string
  startDate: string
  endDate: string
  summary: Record<string, unknown>
  anchorPerformanceSummary?: Record<string, unknown>
  enrichedAnchorLeaderboard?: Array<Record<string, unknown>>
  blacklistedBuyerIds?: string[]
  orderCount: number
  lastBuiltAt: string
  sourceSyncJobId: string | null
  businessCacheFingerprint?: string
  dataGeneration?: BusinessDataGenerationSnapshot | null
  afterSalesCompletenessSummary?: Record<string, unknown> | null
  overviewMeta?: Record<string, unknown> | null
  buildDurationMs?: number
}): Promise<void> {
  if (!shouldRetainBusinessBoardCache(input.preset)) return
  const cacheKey = buildBusinessCacheKey(input.preset, input.startDate, input.endDate)
  const record: BoardPresetSnapshotRecord = {
    cacheKey,
    preset: input.preset,
    startDate: input.startDate,
    endDate: input.endDate,
    summary: input.summary,
    anchorPerformanceSummary: input.anchorPerformanceSummary ?? {},
    enrichedAnchorLeaderboard: input.enrichedAnchorLeaderboard ?? [],
    blacklistedBuyerIds: input.blacklistedBuyerIds ?? [],
    orderCount: input.orderCount,
    lastBuiltAt: input.lastBuiltAt,
    sourceSyncJobId: input.sourceSyncJobId,
    savedAt: new Date().toISOString(),
    businessCacheFingerprint: input.businessCacheFingerprint ?? currentFingerprint(),
    dataGeneration: input.dataGeneration ?? null,
    afterSalesCompletenessSummary: input.afterSalesCompletenessSummary ?? null,
    overviewMeta: input.overviewMeta ?? null,
    payloadVersion: BOARD_SNAPSHOT_PAYLOAD_VERSION,
    buildDurationMs: input.buildDurationMs ?? 0,
  }
  try {
    await fs.mkdir(SNAPSHOT_DIR(), { recursive: true })
    const tmp = `${snapshotPath(cacheKey)}.tmp`
    await fs.writeFile(tmp, JSON.stringify(record), 'utf8')
    await fs.rename(tmp, snapshotPath(cacheKey))
  } catch (err) {
    logWarn(
      '经营快照',
      `写入失败 ${cacheKey}：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export async function readBoardPresetSnapshot(
  preset: string,
  startDate: string,
  endDate: string,
): Promise<BoardPresetSnapshotRecord | null> {
  const cacheKey = buildBusinessCacheKey(preset, startDate, endDate)
  try {
    const raw = await fs.readFile(snapshotPath(cacheKey), 'utf8')
    const parsed = JSON.parse(raw) as BoardPresetSnapshotRecord
    if (!isBoardSnapshotStructurallyUsable(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/** 重启后用磁盘快照构造可立即展示的 stub（无 views；标记 disk_snapshot + 真实指纹） */
export function buildSnapshotBoardCacheStub(
  snap: BoardPresetSnapshotRecord,
): BusinessBoardCacheEntry {
  const range = resolveBusinessRange(
    snap.preset as BusinessRangePreset,
    snap.startDate,
    snap.endDate,
  )
  const fp = snap.businessCacheFingerprint ?? 'snapshot'
  const nowFp = currentFingerprint()
  return {
    cacheKey: snap.cacheKey,
    preset: snap.preset,
    startDate: snap.startDate,
    endDate: snap.endDate,
    scope: 'default',
    range,
    summary: snap.summary,
    anchorLeaderboard: [],
    enrichedAnchorLeaderboard: snap.enrichedAnchorLeaderboard ?? [],
    anchorPerformanceSummary: snap.anchorPerformanceSummary ?? {},
    views: [],
    rawByMatch: new Map(),
    liveSessions: [],
    blacklistedBuyerIds: snap.blacklistedBuyerIds ?? [],
    orderCount: snap.orderCount,
    lastBuiltAt: snap.lastBuiltAt,
    workbenchCacheMaxUpdatedAt: null,
    timeSearchCacheMaxUpdatedAt: null,
    sourceSyncJobId: snap.sourceSyncJobId,
    sourceDataMaxTime: null,
    sourceRawMaxUpdatedAt: null,
    attributionAlgorithmVersion: fp === nowFp ? nowFp : fp,
    buildDurationMs: snap.buildDurationMs ?? 0,
    stale: false,
    buildError: null,
    fallbackReason: 'disk_snapshot',
    dataGeneration: snap.dataGeneration ?? null,
    afterSalesCompletenessSummary: snap.afterSalesCompletenessSummary ?? null,
    overviewMetaSnapshot: snap.overviewMeta ?? null,
  }
}

export async function loadAllBoardPresetSnapshots(): Promise<BoardPresetSnapshotRecord[]> {
  try {
    await fs.mkdir(SNAPSHOT_DIR(), { recursive: true })
    const files = await fs.readdir(SNAPSHOT_DIR())
    const out: BoardPresetSnapshotRecord[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(SNAPSHOT_DIR(), file), 'utf8')
        const parsed = JSON.parse(raw) as BoardPresetSnapshotRecord
        if (isBoardSnapshotStructurallyUsable(parsed)) out.push(parsed)
      } catch {
        /* skip corrupt file */
      }
    }
    if (out.length > 0) {
      logInfo('经营快照', `已加载 ${out.length} 个预设快照（供重启后快速展示）`)
    }
    return out
  } catch (err) {
    logWarn(
      '经营快照',
      `加载失败：${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

/** 清理非标准预设的快照文件（历史月报逐日构建遗留） */
export async function cleanupNonStandardBoardPresetSnapshots(): Promise<number> {
  try {
    await fs.mkdir(SNAPSHOT_DIR(), { recursive: true })
    const files = await fs.readdir(SNAPSHOT_DIR())
    let removed = 0
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      if (!file.includes('_custom_')) continue
      try {
        await fs.unlink(path.join(SNAPSHOT_DIR(), file))
        removed += 1
      } catch {
        /* skip */
      }
    }
    if (removed > 0) {
      logInfo('经营快照', `已清理 ${removed} 个非标准预设快照`)
    }
    return removed
  } catch (err) {
    logWarn(
      '经营快照',
      `清理非标准快照失败：${err instanceof Error ? err.message : String(err)}`,
    )
    return 0
  }
}
