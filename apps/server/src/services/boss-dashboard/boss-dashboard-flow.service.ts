import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  BOSS_FLOW_MAX_PAGES_FIRST_SYNC,
  BOSS_FLOW_PAGE_SIZE,
  BOSS_FLOW_HALT_AFTER_KNOWN,
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
import { logInfo } from '../../utils/server-log'

async function upsertFlowRows(
  shop: GoodReviewShopDefinition,
  liveAccountId: string,
  rows: ParsedBossFlowRow[],
): Promise<{ inserted: number; knownHits: number }> {
  let inserted = 0
  let knownHits = 0
  for (const row of rows) {
    const existing = await prisma.bossAccountFlow.findUnique({
      where: { shopKey_platformFlowId: { shopKey: shop.shopKey, platformFlowId: row.platformFlowId } },
      select: { id: true },
    })
    if (existing) {
      knownHits++
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
  return { inserted, knownHits }
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
  let consecutiveKnown = 0
  let stoppedEarly = false
  const maxPages = firstSync ? BOSS_FLOW_MAX_PAGES_FIRST_SYNC : 20

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const payload = await fetchBossAccountRecordPage(params.shop, pageNum, BOSS_FLOW_PAGE_SIZE)
    const parsed = parseBossAccountRecordPage(payload)
    pagesFetched++
    if (parsed.rows.length === 0) break

    const result = await upsertFlowRows(params.shop, params.liveAccountId, parsed.rows)
    inserted += result.inserted

    if (!firstSync) {
      consecutiveKnown += result.knownHits
      if (result.knownHits > 0 && result.inserted === 0) {
        if (consecutiveKnown >= BOSS_FLOW_HALT_AFTER_KNOWN) {
          stoppedEarly = true
          break
        }
      } else {
        consecutiveKnown = 0
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
  const now = new Date()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setMonth(d.getMonth() - i)
    keys.push(shanghaiMonthKey(d))
  }
  return keys
}

export async function aggregateMonthlyStatementIncome(
  shopKey: string,
  monthKeys: string[],
): Promise<Array<{ month: string; amountCent: number }>> {
  const rows = await prisma.bossAccountFlow.findMany({
    where: { shopKey, flowKind: 'statement_in', incomeAmountCent: { gt: 0 } },
    select: { occurredAt: true, incomeAmountCent: true },
  })
  const map = new Map<string, number>()
  for (const m of monthKeys) map.set(m, 0)
  for (const row of rows) {
    const m = shanghaiMonthKey(row.occurredAt)
    if (!map.has(m)) continue
    map.set(m, (map.get(m) ?? 0) + row.incomeAmountCent)
  }
  return monthKeys.map((month) => ({ month, amountCent: map.get(month) ?? 0 }))
}

export { isSettlementIncomeRow, isWithdrawSuccessRow }
