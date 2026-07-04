import { attributeOrders } from './order-attribution.service'
import { getAnchorConfigSync } from './anchor.service'
import { fetchQualityDetailPage, fetchQualitySummaryPage } from './quality-badcase-api.service'
import { normalizeQualityDetailRow } from './quality-badcase-normalizer.service'
import {
  loadOrdersForQualityMatch,
  matchQualityBadCases,
} from './quality-badcase-match.service'
import {
  invalidateQualityBadCaseMemoryCache,
  loadAllQualityBadCases,
  saveQualityBadCases,
  saveQualityBadCaseSyncMeta,
} from './quality-badcase-store.service'
import { markBuyerRankingCacheStaleAfterQualitySync } from './buyer-ranking-cache.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { buildRawAnalyzeBundleAll } from './xhs-api-sync/xhs-analysis-from-raw.service'
import {
  cleanupOrphanQualityBadCaseSyncJobs,
  listOfficialQualitySyncCandidateAccounts,
} from './quality-badcase-orphan-cleanup.service'
import { appendQualityBadCaseSyncLog } from './quality-badcase-sync-log.service'
import { logInfo } from '../utils/server-log'
import {
  formatSyncDateRange,
  logBusinessSyncContinueNext,
  logQualitySyncComplete,
  logQualitySyncFailed,
  logQualitySyncStart,
  type SyncAccountContext,
} from '../utils/sync-cmd-log'

const SUMMARY_PAGE_SIZE = 10
const DETAIL_PAGE_SIZE = 20

export interface QualityBadCasePerAccountRow {
  liveAccountId: string
  accountName: string
  apiRows: number
  caseCount: number
  matchedOrders: number
  status: '成功' | '无新数据' | '失败'
  failReason?: string
}

export interface QualityBadCaseSyncResult {
  ok: boolean
  data: {
    itemCount: number
    caseCount: number
    matchedOrderCount: number
    matchedAfterSaleCount: number
    unmatchedCount: number
    lastSyncedAt: string
    durationMs: number
    unmatchedPackageIds: string[]
    accountCount: number
  }
  perAccount: QualityBadCasePerAccountRow[]
  error?: string
}

async function fetchAllBadCasesForAccount(account: {
  id: string
  name: string
  platformName: string
}): Promise<{
  itemCount: number
  cases: NormalizedQualityBadCase[]
}> {
  const allCases: NormalizedQualityBadCase[] = []
  let itemCount = 0
  const itemsWithBadCases: Array<{
    itemId: string
    itemName: string
    itemImage: string
    negativePayPkgCnt: number
    negativePayPkgRate: number
    negativeSellerPkgProportion: number
    negativeReasonList: string[]
    negativeReasonDetailList: Array<{ reason?: string; count?: number; solution?: string }>
  }> = []

  let summaryPage = 1
  let summaryTotal = Infinity
  while ((summaryPage - 1) * SUMMARY_PAGE_SIZE < summaryTotal) {
    const page = await fetchQualitySummaryPage({
      pageNo: summaryPage,
      pageSize: SUMMARY_PAGE_SIZE,
      liveAccountId: account.id,
      accountName: account.name,
    })
    summaryTotal = page.count
    if (!page.items.length) break
    for (const item of page.items) {
      if (item.negativePayPkgCnt > 0) itemsWithBadCases.push(item)
    }
    itemCount += page.items.length
    summaryPage += 1
  }

  for (const summary of itemsWithBadCases) {
    let detailPage = 1
    let detailTotal = Infinity
    while ((detailPage - 1) * DETAIL_PAGE_SIZE < detailTotal) {
      const detail = await fetchQualityDetailPage({
        itemId: summary.itemId,
        pageNo: detailPage,
        pageSize: DETAIL_PAGE_SIZE,
        liveAccountId: account.id,
        accountName: account.name,
      })
      detailTotal = detail.count
      if (!detail.items.length) break
      for (const row of detail.items) {
        allCases.push({
          ...normalizeQualityDetailRow(row, summary, account.id),
          platformName: account.platformName,
        })
      }
      detailPage += 1
    }
  }

  return { itemCount, cases: allCases }
}

/** 将已存官方品退与订单主表重新匹配（订单同步后补匹配） */
export async function rematchStoredQualityBadCases(): Promise<number> {
  const existing = await loadAllQualityBadCases(true)
  if (!existing.length) return 0

  const bundle = await buildRawAnalyzeBundleAll()
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const orders = artifacts?.dedupe.uniqueOrders ?? (await loadOrdersForQualityMatch())
  const anchorConfig = getAnchorConfigSync()
  const attributions = attributeOrders(orders, bundle?.liveSessions ?? [], anchorConfig)

  const rematched = matchQualityBadCases({
    cases: existing.map((c) => ({ ...c, matchStatus: 'unmatched' as const })),
    orders,
    attributions,
    rawAfterSalesByOrderNo: bundle?.rawAfterSalesByOrderNo,
  })
  await saveQualityBadCases(rematched)
  invalidateQualityBadCaseMemoryCache()
  await loadAllQualityBadCases(true)
  const { rebuildBusinessBoardCacheAfterQualityDataChange } = await import(
    './quality-badcase-cache-hooks.service'
  )
  await rebuildBusinessBoardCacheAfterQualityDataChange('官方品退重新匹配订单')
  return rematched.length
}

export async function syncOfficialQualityBadCases(params?: {
  windowDays?: number
  force?: boolean
  /** @deprecated 请使用 liveAccountIds */
  platformNames?: string[]
  liveAccountIds?: string[]
}): Promise<QualityBadCaseSyncResult> {
  const started = Date.now()
  const windowDays = params?.windowDays ?? 30
  await cleanupOrphanQualityBadCaseSyncJobs({ logOrphans: true })
  const allAccounts = await listOfficialQualitySyncCandidateAccounts()
  let accounts = allAccounts
  if (params?.liveAccountIds?.length) {
    const idSet = new Set(params.liveAccountIds)
    accounts = allAccounts.filter((a) => idSet.has(a.id))
  } else if (params?.platformNames?.length) {
    const nameSet = new Set(params.platformNames)
    accounts = allAccounts.filter((a) => nameSet.has(a.platformName))
  }

  if (accounts.length === 0) {
    const durationMs = Date.now() - started
    appendQualityBadCaseSyncLog({
      level: 'info',
      message: '无启用的直播号可同步官方品退，已跳过',
    })
    return {
      ok: false,
      error: '无启用的直播号可同步官方品退',
      perAccount: [],
      data: {
        itemCount: 0,
        caseCount: 0,
        matchedOrderCount: 0,
        matchedAfterSaleCount: 0,
        unmatchedCount: 0,
        lastSyncedAt: new Date().toISOString(),
        durationMs,
        unmatchedPackageIds: [],
        accountCount: 0,
      },
    }
  }

  const now = new Date()
  const rangeEnd = now.toISOString().slice(0, 10)
  const rangeStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const dateRange = formatSyncDateRange(rangeStart, rangeEnd)
  const accountTotal = accounts.length

  const byCaseKey = new Map<string, NormalizedQualityBadCase>()
  let itemCount = 0
  let lastError: string | undefined
  const perAccount: QualityBadCasePerAccountRow[] = []

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]!
    const accountIndex = i + 1
    const accountCtx: SyncAccountContext = {
      accountName: account.name,
      liveAccountId: account.id,
      accountIndex,
      accountTotal,
    }
    const legacyAccount =
      account.platformName === 'xiaohongshu' && account.name !== 'xiaohongshu'
        ? account.platformName
        : undefined
    const accountStarted = Date.now()
    logQualitySyncStart(accountCtx, dateRange)
    try {
      const fetched = await fetchAllBadCasesForAccount(account)
      itemCount += fetched.itemCount
      for (const c of fetched.cases) {
        byCaseKey.set(`${c.liveAccountId}::${c.caseKey}`, c)
      }
      const durationSec = (Date.now() - accountStarted) / 1000
      logQualitySyncComplete({
        ctx: accountCtx,
        apiRows: fetched.cases.length,
        matchedOrders: fetched.cases.length,
        saved: fetched.cases.length,
        durationSec,
      })
      appendQualityBadCaseSyncLog({
        level: 'info',
        message: `同步完成 items=${fetched.itemCount} cases=${fetched.cases.length}`,
        accountName: account.name,
        liveAccountId: account.id,
        legacyAccount,
      })
      perAccount.push({
        liveAccountId: account.id,
        accountName: account.name,
        apiRows: fetched.cases.length,
        caseCount: fetched.cases.length,
        matchedOrders: fetched.cases.length,
        status: fetched.cases.length === 0 ? '无新数据' : '成功',
      })
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      const isSignFailure =
        /签名|xhshow|Python|python|script_not_found|sign_generation/i.test(lastError)
      const reason = isSignFailure
        ? '签名模块异常'
        : lastError.slice(0, 120)
      logQualitySyncFailed(accountCtx, reason)
      appendQualityBadCaseSyncLog({
        level: 'warn',
        message: `同步失败: ${lastError}`,
        accountName: account.name,
        liveAccountId: account.id,
        legacyAccount,
      })
      perAccount.push({
        liveAccountId: account.id,
        accountName: account.name,
        apiRows: 0,
        caseCount: 0,
        matchedOrders: 0,
        status: '失败',
        failReason: reason,
      })
      if (i + 1 < accounts.length) {
        logBusinessSyncContinueNext({
          accountName: accounts[i + 1]!.name,
          liveAccountId: accounts[i + 1]!.id,
          accountIndex: i + 2,
          accountTotal,
        })
      }
    }
  }

  const allCases = [...byCaseKey.values()]
  if (allCases.length === 0) {
    const durationMs = Date.now() - started
    return {
      ok: false,
      error: lastError ?? '官方品质问题接口未返回数据',
      perAccount,
      data: {
        itemCount: 0,
        caseCount: 0,
        matchedOrderCount: 0,
        matchedAfterSaleCount: 0,
        unmatchedCount: 0,
        lastSyncedAt: new Date().toISOString(),
        durationMs,
        unmatchedPackageIds: [],
        accountCount: accounts.length,
      },
    }
  }

  const bundle = await buildRawAnalyzeBundleAll()
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const orders = artifacts?.dedupe.uniqueOrders ?? (await loadOrdersForQualityMatch())
  const anchorConfig = getAnchorConfigSync()
  const attributions = attributeOrders(orders, bundle?.liveSessions ?? [], anchorConfig)

  const matchedCases = matchQualityBadCases({
    cases: allCases,
    orders,
    attributions,
    rawAfterSalesByOrderNo: bundle?.rawAfterSalesByOrderNo,
  })

  await saveQualityBadCases(matchedCases)
  invalidateQualityBadCaseMemoryCache()
  await loadAllQualityBadCases(true)
  await markBuyerRankingCacheStaleAfterQualitySync()
  const { rebuildBusinessBoardCacheAfterQualityDataChange } = await import(
    './quality-badcase-cache-hooks.service'
  )
  await rebuildBusinessBoardCacheAfterQualityDataChange('官方品退数据更新')

  const matchedOrderCount = matchedCases.filter(
    (c) => c.matchStatus === 'matched_order_and_after_sale' || c.matchStatus === 'matched_order_only',
  ).length
  const matchedAfterSaleCount = matchedCases.filter(
    (c) =>
      c.matchStatus === 'matched_order_and_after_sale' ||
      c.matchStatus === 'matched_after_sale_only',
  ).length
  const unmatchedCount = matchedCases.filter((c) => c.matchStatus === 'unmatched').length
  const startTime = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')

  for (const row of perAccount) {
    if (row.status === '失败') continue
    const accountCases = matchedCases.filter((c) => c.liveAccountId === row.liveAccountId)
    row.caseCount = accountCases.length
    row.matchedOrders = accountCases.filter(
      (c) =>
        c.matchStatus === 'matched_order_and_after_sale' ||
        c.matchStatus === 'matched_order_only',
    ).length
  }

  await saveQualityBadCaseSyncMeta({
    windowDays,
    startTime,
    endTime: now.toISOString().slice(0, 19).replace('T', ' '),
    itemCount,
    caseCount: matchedCases.length,
    matchedOrderCount,
    matchedAfterSaleCount,
    unmatchedCount,
  })

  const unmatchedPackageIds = matchedCases
    .filter((c) => c.matchStatus === 'unmatched')
    .map((c) => c.packageId)
    .slice(0, 20)

  const durationMs = Date.now() - started
  logInfo(
    '官方品退',
    `全部完成：${accounts.length} 个账号，${matchedCases.length} 条品退，匹配订单 ${matchedOrderCount} 单，用时 ${(durationMs / 1000).toFixed(1)} 秒`,
  )
  appendQualityBadCaseSyncLog({
    level: 'info',
    message: `汇总 accounts=${accounts.length} cases=${matchedCases.length} ms=${durationMs}`,
  })

  return {
    ok: true,
    perAccount,
    data: {
      itemCount,
      caseCount: matchedCases.length,
      matchedOrderCount,
      matchedAfterSaleCount,
      unmatchedCount,
      lastSyncedAt: now.toISOString(),
      durationMs,
      unmatchedPackageIds,
      accountCount: accounts.length,
    },
  }
}
