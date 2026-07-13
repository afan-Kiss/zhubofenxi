import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataDir } from '../config/env'
import { buildBusinessCacheKey } from './business-cache.service'
import { resolveBusinessRange, type BusinessRangePreset } from '../utils/business-range'
import { logInfo, logWarn } from '../utils/server-log'

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
}

const SNAPSHOT_DIR = () => path.join(getDataDir(), 'board-snapshots')

function snapshotPath(cacheKey: string): string {
  const safe = cacheKey.replace(/[|]/g, '_')
  return path.join(SNAPSHOT_DIR(), `${safe}.json`)
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
}): Promise<void> {
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
  }
  try {
    await fs.mkdir(SNAPSHOT_DIR(), { recursive: true })
    await fs.writeFile(snapshotPath(cacheKey), JSON.stringify(record), 'utf8')
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
    if (!parsed?.summary || typeof parsed.summary !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/** 重启后内存未预热时，用磁盘快照构造只读占位（无 views，仅供总览秒开） */
export function buildSnapshotBoardCacheStub(
  snap: BoardPresetSnapshotRecord,
): import('./business-cache.service').BusinessBoardCacheEntry {
  const range = resolveBusinessRange(
    snap.preset as BusinessRangePreset,
    snap.startDate,
    snap.endDate,
  )
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
    sourceSyncJobId: snap.sourceSyncJobId,
    sourceDataMaxTime: null,
    sourceRawMaxUpdatedAt: null,
    attributionAlgorithmVersion: 'snapshot',
    buildDurationMs: 0,
    stale: false,
    buildError: null,
    fallbackReason: 'disk_snapshot',
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
        if (parsed?.summary) out.push(parsed)
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
