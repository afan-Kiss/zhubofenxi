import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  BOSS_FLOW_MAX_PAGES_FIRST_SYNC,
  BOSS_FLOW_MIN_PAGES_INCREMENTAL,
  BOSS_FLOW_PAGE_SIZE,
  BOSS_INCOME_MONTHS,
} from '../../config/boss-dashboard.constants'
import { fetchBossAccountRecordPage } from './boss-dashboard-api.service'
import {
  isSettlementIncomeRow,
  isWithdrawSuccessRow,
  parseBossAccountRecordPage,
  type ParsedBossFlowRow,
} from './boss-dashboard-normalize.service'
import { formatDateKeyShanghai, shanghaiMonthKey } from '../../utils/business-timezone'

const FLOW_ROW_SELECT = {
  id: true,
  flowKind: true,
  flowType: true,
  flowTypeDesc: true,
  occurredAt: true,
  incomeAmountCent: true,
  outcomeAmountCent: true,
  businessNo: true,
  balanceAfterCent: true,
} as const
import { logInfo } from '../../utils/server-log'

function flowRowChanged(
  existing: {
    flowKind: string
    flowType: string | null
    flowTypeDesc: string | null
    occurredAt: Date
    incomeAmountCent: number
    outcomeAmountCent: number
    businessNo: string | null
    balanceAfterCent: number | null
  },
  row: ParsedBossFlowRow,
): boolean {
  return (
    existing.flowKind !== row.flowKind ||
    existing.flowType !== row.flowType ||
    existing.flowTypeDesc !== row.flowTypeDesc ||
    existing.occurredAt.getTime() !== row.occurredAt.getTime() ||
    existing.incomeAmountCent !== row.incomeAmountCent ||
    existing.outcomeAmountCent !== row.outcomeAmountCent ||
    existing.businessNo !== row.businessNo ||
    existing.balanceAfterCent !== row.balanceAfterCent
  )
}

async function upsertFlowRows(
  shop: GoodReviewShopDefinition,
  liveAccountId: string,
  rows: ParsedBossFlowRow[],
): Promise<{ inserted: number; updated: number; knownHits: number }> {
  let inserted = 0
  let updated = 0
  let knownHits = 0
  for (const row of rows) {
    const existing = await prisma.bossAccountFlow.findUnique({
      where: { shopKey_platformFlowId: { shopKey: shop.shopKey, platformFlowId: row.platformFlowId } },
      select: FLOW_ROW_SELECT,
    })
    if (existing) {
      if (flowRowChanged(existing, row)) {
        await prisma.bossAccountFlow.update({
          where: { id: existing.id },
          data: {
            flowKind: row.flowKind,
            flowType: row.flowType,
            flowTypeDesc: row.flowTypeDesc,
            occurredAt: row.occurredAt,
            incomeAmountCent: row.incomeAmountCent,
            outcomeAmountCent: row.outcomeAmountCent,
            businessNo: row.businessNo,
            balanceAfterCent: row.balanceAfterCent,
            rawJson: JSON.stringify(row.raw),
          },
        })
        updated++
      } else {
        knownHits++
      }
      continue
    }
    await prisma.bossAccountFlow.create({
      data: {
        shopKey: shop.shopKey,
        liveAccountId,
        platformFlowId: row.platformFlowId,
        flowKind: row.flowKind,
        flowType: row.flowType,
        flowTypeDesc: row.flowTypeDesc,
        occurredAt: row.occurredAt,
        incomeAmountCent: row.incomeAmountCent,
        outcomeAmountCent: row.outcomeAmountCent,
        businessNo: row.businessNo,
        balanceAfterCent: row.balanceAfterCent,
        rawJson: JSON.stringify(row.raw),
      },
    })
    inserted++
  }
  return { inserted, updated, knownHits }
}

async function getLatestLocalFlowTime(shopKey: string): Promise<Date | null> {
  const latest = await prisma.bossAccountFlow.findFirst({
    where: { shopKey },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true },
  })
  return latest?.occurredAt ?? null
}

function pageMaxOccurredAt(rows: ParsedBossFlowRow[]): Date | null {
  if (rows.length === 0) return null
  let max = rows[0]!.occurredAt.getTime()
  for (const row of rows) {
    const t = row.occurredAt.getTime()
    if (t > max) max = t
  }
  return new Date(max)
}

export async function syncBossAccountFlowsForShop(params: {
  shop: GoodReviewShopDefinition
  liveAccountId: string
  firstSync: boolean
}): Promise<{ inserted: number; pagesFetched: number; stoppedEarly: boolean }> {
  const existingCount = await prisma.bossAccountFlow.count({
    where: { shopKey: params.shop.shopKey },
  })
  const firstSync = params.firstSync || existingCount === 0
  let inserted = 0
  let pagesFetched = 0
  let stoppedEarly = false
  const maxPages = firstSync ? BOSS_FLOW_MAX_PAGES_FIRST_SYNC : 20
  const localLatest = firstSync ? null : await getLatestLocalFlowTime(params.shop.shopKey)

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const payload = await fetchBossAccountRecordPage(params.shop, pageNum, BOSS_FLOW_PAGE_SIZE)
    const parsed = parseBossAccountRecordPage(payload)
    pagesFetched++
    if (parsed.rows.length === 0) break

    const result = await upsertFlowRows(params.shop, params.liveAccountId, parsed.rows)
    inserted += result.inserted

    if (!firstSync && pageNum >= BOSS_FLOW_MIN_PAGES_INCREMENTAL) {
      const pageAllKnown = parsed.rows.length > 0 && result.knownHits === parsed.rows.length
      if (result.inserted === 0 && pageAllKnown && localLatest) {
        const pageMax = pageMaxOccurredAt(parsed.rows)
        if (pageMax && pageMax.getTime() <= localLatest.getTime()) {
          stoppedEarly = true
          break
        }
      }
    }

    if (pageNum >= parsed.totalPage) break
  }

  logInfo(
    '老板同步',
    `${params.shop.shopName} 流水：新增 ${inserted} 条，翻页 ${pagesFetched}${stoppedEarly ? '，遇历史停止' : ''}`,
  )
  return { inserted, pagesFetched, stoppedEarly }
}

export async function computeWithdrawnAmountCent(shopKey: string): Promise<number> {
  const rows = await prisma.bossAccountFlow.findMany({
    where: { shopKey, flowKind: 'withdraw_success' },
    select: { outcomeAmountCent: true },
  })
  return rows.reduce((sum, r) => sum + (r.outcomeAmountCent ?? 0), 0)
}

export async function computeTodayIncomeCent(shopKey: string, dateKey = formatDateKeyShanghai()): Promise<number> {
  const start = new Date(`${dateKey}T00:00:00+08:00`)
  const end = new Date(`${dateKey}T23:59:59+08:00`)
  const rows = await prisma.bossAccountFlow.findMany({
    where: {
      shopKey,
      flowKind: 'statement_in',
      occurredAt: { gte: start, lte: end },
      incomeAmountCent: { gt: 0 },
    },
    select: { incomeAmountCent: true },
  })
  return rows.reduce((sum, r) => sum + r.incomeAmountCent, 0)
}

export function buildRecentMonthKeys(count = BOSS_INCOME_MONTHS): string[] {
  const keys: string[] = []
  const today = formatDateKeyShanghai()
  const [y, m] = today.split('-').map(Number)
  let year = y!
  let month = m!
  for (let i = 0; i < count; i++) {
    keys.unshift(`${year}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month <= 0) {
      month = 12
      year -= 1
    }
  }
  return keys
}

export async function aggregateMonthlyStatementIncome(
  shopKey: string,
  monthKeys: string[],
): Promise<Array<{ month: string; amountCent: number | null }>> {
  const monthSet = new Set(monthKeys)
  const rows = await prisma.bossAccountFlow.findMany({
    where: { shopKey, flowKind: 'statement_in', incomeAmountCent: { gt: 0 } },
    select: { occurredAt: true, incomeAmountCent: true },
  })
  const map = new Map<string, number>()
  for (const row of rows) {
    const m = shanghaiMonthKey(row.occurredAt)
    if (!monthSet.has(m)) continue
    map.set(m, (map.get(m) ?? 0) + row.incomeAmountCent)
  }
  return monthKeys.map((month) => ({
    month,
    amountCent: map.has(month) ? map.get(month)! : null,
  }))
}

export { isSettlementIncomeRow, isWithdrawSuccessRow }
