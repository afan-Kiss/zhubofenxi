import { prisma } from '../lib/prisma'
import type { QualityBadCase } from '@prisma/client'
import type {
  NormalizedQualityBadCase,
  QualityBadCaseCoverage,
} from './quality-badcase.types'
import { isQualityBadCaseOrderMatched } from './quality-badcase.types'
import {
  liveAccountPackageKey,
  resolveLiveAccountId,
} from '../utils/live-account-cache-key.util'

let memoryCases: NormalizedQualityBadCase[] | null = null
let memoryLoadedAt = 0
const MEMORY_TTL_MS = 60_000

function rowToNormalized(row: QualityBadCase): NormalizedQualityBadCase {
  let negativeReasons: string[] = []
  try {
    negativeReasons = JSON.parse(row.negativeReasonsJson) as string[]
  } catch {
    negativeReasons = []
  }
  return {
    caseKey: row.caseKey,
    liveAccountId: resolveLiveAccountId(row.liveAccountId),
    packageId: row.packageId,
    sourceBizId: row.sourceBizId,
    itemId: row.itemId ?? '',
    itemName: row.itemName ?? '',
    itemImage: row.itemImage ?? '',
    problemType: row.problemType,
    negativeReasons,
    feedbackContent: row.feedbackContent ?? '',
    feedbackTime: row.feedbackTime,
    packagePayTime: row.packagePayTime,
    matchedOrderNo: row.matchedOrderNo ?? row.packageId,
    matchedOrderId: row.matchedOrderId ?? '',
    matchedAfterSaleId: row.matchedAfterSaleId ?? '',
    matchedBuyerId: row.matchedBuyerId ?? '',
    matchedBuyerNickname: row.matchedBuyerNickname ?? '',
    matchedAnchorId: row.matchedAnchorId ?? '',
    matchedAnchorName: row.matchedAnchorName ?? '',
    afterSaleStatus: row.afterSaleStatus ?? '',
    afterSaleReason: row.afterSaleReason ?? '',
    afterSaleRefundAmount: row.afterSaleRefundAmountCent / 100,
    afterSaleRefunded: row.afterSaleRefunded,
    source: 'official_quality_badcase',
    matchStatus: row.matchStatus as NormalizedQualityBadCase['matchStatus'],
    confidence: row.confidence,
  }
}

export async function saveQualityBadCases(cases: NormalizedQualityBadCase[]): Promise<void> {
  const now = new Date()
  for (const c of cases) {
    const liveAccountId = resolveLiveAccountId(c.liveAccountId)
    await prisma.qualityBadCase.upsert({
      where: {
        liveAccountId_caseKey: {
          liveAccountId,
          caseKey: c.caseKey,
        },
      },
      create: {
        liveAccountId,
        caseKey: c.caseKey,
        packageId: c.packageId,
        sourceBizId: c.sourceBizId,
        itemId: c.itemId,
        itemName: c.itemName,
        itemImage: c.itemImage,
        problemType: c.problemType,
        negativeReasonsJson: JSON.stringify(c.negativeReasons),
        feedbackContent: c.feedbackContent,
        feedbackTime: c.feedbackTime,
        packagePayTime: c.packagePayTime,
        rawJson: null,
        matchedOrderNo: c.matchedOrderNo,
        matchedOrderId: c.matchedOrderId,
        matchedAfterSaleId: c.matchedAfterSaleId,
        matchedBuyerId: c.matchedBuyerId,
        matchedBuyerNickname: c.matchedBuyerNickname,
        matchedAnchorId: c.matchedAnchorId,
        matchedAnchorName: c.matchedAnchorName,
        afterSaleStatus: c.afterSaleStatus,
        afterSaleReason: c.afterSaleReason,
        afterSaleRefundAmountCent: Math.round(c.afterSaleRefundAmount * 100),
        afterSaleRefunded: c.afterSaleRefunded,
        source: c.source,
        matchStatus: c.matchStatus,
        confidence: c.confidence,
        syncedAt: now,
        updatedAt: now,
      },
      update: {
        liveAccountId,
        packageId: c.packageId,
        sourceBizId: c.sourceBizId,
        itemId: c.itemId,
        itemName: c.itemName,
        itemImage: c.itemImage,
        problemType: c.problemType,
        negativeReasonsJson: JSON.stringify(c.negativeReasons),
        feedbackContent: c.feedbackContent,
        feedbackTime: c.feedbackTime,
        packagePayTime: c.packagePayTime,
        matchedOrderNo: c.matchedOrderNo,
        matchedOrderId: c.matchedOrderId,
        matchedAfterSaleId: c.matchedAfterSaleId,
        matchedBuyerId: c.matchedBuyerId,
        matchedBuyerNickname: c.matchedBuyerNickname,
        matchedAnchorId: c.matchedAnchorId,
        matchedAnchorName: c.matchedAnchorName,
        afterSaleStatus: c.afterSaleStatus,
        afterSaleReason: c.afterSaleReason,
        afterSaleRefundAmountCent: Math.round(c.afterSaleRefundAmount * 100),
        afterSaleRefunded: c.afterSaleRefunded,
        matchStatus: c.matchStatus,
        confidence: c.confidence,
        syncedAt: now,
        updatedAt: now,
      },
    })
  }
  memoryCases = cases
  memoryLoadedAt = Date.now()
}

export async function loadAllQualityBadCases(force = false): Promise<NormalizedQualityBadCase[]> {
  if (!force && memoryCases && Date.now() - memoryLoadedAt < MEMORY_TTL_MS) {
    return memoryCases
  }
  const rows = await prisma.qualityBadCase.findMany({ orderBy: { feedbackTime: 'desc' } })
  memoryCases = rows.map(rowToNormalized)
  memoryLoadedAt = Date.now()
  return memoryCases
}

export function getOfficialQualityPackageIdSet(cases: NormalizedQualityBadCase[]): Set<string> {
  const set = new Set<string>()
  for (const c of cases) {
    if (!isQualityBadCaseOrderMatched(c)) continue
    if (c.matchedOrderNo) {
      set.add(liveAccountPackageKey(c.liveAccountId, c.matchedOrderNo))
    }
    if (c.packageId) {
      set.add(liveAccountPackageKey(c.liveAccountId, c.packageId))
    }
  }
  return set
}

/** 仅已匹配系统订单的官方品退，按 liveAccountId + P 单号索引 */
export function getMatchedOfficialQualityCasesByPackage(
  cases: NormalizedQualityBadCase[],
): Map<string, NormalizedQualityBadCase[]> {
  const map = new Map<string, NormalizedQualityBadCase[]>()
  for (const c of cases) {
    if (!isQualityBadCaseOrderMatched(c)) continue
    const pkg = c.matchedOrderNo || c.packageId
    if (!pkg) continue
    const key = liveAccountPackageKey(c.liveAccountId, pkg)
    const list = map.get(key) ?? []
    list.push(c)
    map.set(key, list)
  }
  return map
}

/** @deprecated 使用 getMatchedOfficialQualityCasesByPackage */
export function getOfficialQualityCasesByPackage(
  cases: NormalizedQualityBadCase[],
): Map<string, NormalizedQualityBadCase[]> {
  return getMatchedOfficialQualityCasesByPackage(cases)
}

export function countUnmatchedOfficialQualityCases(cases: NormalizedQualityBadCase[]): number {
  return cases.filter((c) => c.matchStatus === 'unmatched').length
}

export async function getQualityBadCaseCoverage(): Promise<QualityBadCaseCoverage> {
  const meta = await prisma.qualityBadCaseSyncMeta.findUnique({ where: { id: 'default' } })
  if (!meta) {
    return {
      source: 'official_quality_badcase',
      windowDays: 30,
      startTime: null,
      endTime: null,
      lastSyncedAt: null,
    }
  }
  return {
    source: 'official_quality_badcase',
    windowDays: meta.windowDays,
    startTime: meta.startTime,
    endTime: meta.endTime,
    lastSyncedAt: meta.lastSyncedAt?.toISOString() ?? null,
  }
}

export async function saveQualityBadCaseSyncMeta(input: {
  windowDays: number
  startTime: string | null
  endTime: string | null
  itemCount: number
  caseCount: number
  matchedOrderCount: number
  matchedAfterSaleCount: number
  unmatchedCount: number
}): Promise<void> {
  const now = new Date()
  await prisma.qualityBadCaseSyncMeta.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      source: 'official_quality_badcase',
      windowDays: input.windowDays,
      startTime: input.startTime,
      endTime: input.endTime,
      lastSyncedAt: now,
      itemCount: input.itemCount,
      caseCount: input.caseCount,
      matchedOrderCount: input.matchedOrderCount,
      matchedAfterSaleCount: input.matchedAfterSaleCount,
      unmatchedCount: input.unmatchedCount,
      updatedAt: now,
    },
    update: {
      windowDays: input.windowDays,
      startTime: input.startTime,
      endTime: input.endTime,
      lastSyncedAt: now,
      itemCount: input.itemCount,
      caseCount: input.caseCount,
      matchedOrderCount: input.matchedOrderCount,
      matchedAfterSaleCount: input.matchedAfterSaleCount,
      unmatchedCount: input.unmatchedCount,
      updatedAt: now,
    },
  })
}

export function getQualityBadCasesSync(): NormalizedQualityBadCase[] {
  return memoryCases ?? []
}

export function invalidateQualityBadCaseMemoryCache(): void {
  memoryCases = null
  memoryLoadedAt = 0
}

export async function bootstrapQualityBadCaseCache(): Promise<void> {
  await loadAllQualityBadCases(true)
  const { seedHarQualityBadCaseFixturesIfNeeded } = await import(
    './quality-badcase-har-fixture.service'
  )
  if ((memoryCases?.length ?? 0) === 0) {
    const seeded = await seedHarQualityBadCaseFixturesIfNeeded()
    if (seeded.seeded > 0) {
      console.log(
        `[quality-badcase-store] HAR 种子已写入 cases=${seeded.seeded} matched=${seeded.matchedOrderCount}`,
      )
      if (seeded.matchedOrderCount > 0) {
        const { markBuyerRankingCacheStaleAfterQualitySync } = await import(
          './buyer-ranking-cache.service'
        )
        const { rebuildBusinessBoardCacheAfterQualityDataChange } = await import(
          './quality-badcase-cache-hooks.service'
        )
        await markBuyerRankingCacheStaleAfterQualitySync()
        await rebuildBusinessBoardCacheAfterQualityDataChange('官方品退数据更新')
      }
    }
    await loadAllQualityBadCases(true)
    return
  }

  const unmatchedHar =
    (memoryCases ?? []).length > 0 &&
    (memoryCases ?? []).every(
      (c) => c.caseKey.startsWith('har_') && c.matchStatus === 'unmatched',
    )
  if (unmatchedHar) {
    const rematched = await seedHarQualityBadCaseFixturesIfNeeded({ force: true })
    if (rematched.matchedOrderCount > 0) {
      console.log(
        `[quality-badcase-store] HAR 样例已重新匹配 orders=${rematched.matchedOrderCount}`,
      )
      const { markBuyerRankingCacheStaleAfterQualitySync } = await import(
        './buyer-ranking-cache.service'
      )
      const { rebuildBusinessBoardCacheAfterQualityDataChange } = await import(
        './quality-badcase-cache-hooks.service'
      )
      await markBuyerRankingCacheStaleAfterQualitySync()
      await rebuildBusinessBoardCacheAfterQualityDataChange('官方品退数据更新')
    }
    await loadAllQualityBadCases(true)
  }
}
