import {
  BOSS_BILL_PAGE_SIZE,
  BOSS_BILL_SCAN_FALLBACK_DAYS,
  BOSS_BILL_WINDOW_DAYS,
  BOSS_INCOME_MONTHS,
} from '../../config/boss-dashboard.constants'
import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import {
  addDaysShanghai,
  formatDateKeyShanghai,
  shanghaiMonthKey,
  startOfMonthKeyShanghai,
} from '../../utils/business-timezone'
import { logInfo, logWarn } from '../../utils/server-log'
import {
  fetchBossBillStoreInfoAudited,
  fetchBossPeriodFundBillListAudited,
  fetchBossPeriodSettleBillListAudited,
  fetchBossSellerPreIncomeAudited,
  fetchBossSettleBillListAudited,
} from './boss-dashboard-bill-api.service'
import {
  buildThirtyDayWindows,
  checkPendingReconciliation,
  parseBossPeriodFundBillPage,
  parseBossPeriodSettleBillPage,
  parseBossSellerPreIncome,
  parseBossSettleBillListPage,
  parseBossStoreInfo,
  type ParsedBossPendingSettleOrder,
} from './boss-dashboard-bill-normalize.service'

const PENDING_LIST_BODY_BASE = {
  sortBy: 'ORDER_CREATE_TIME',
  sortOrder: 'DESC',
  settleStatus: 'INIT',
  timeType: 'ORDER_CREATE_TIME',
  pageSize: BOSS_BILL_PAGE_SIZE,
} as const

function mergeErrors(parts: Array<string | null | undefined>): string | null {
  const msgs = parts.filter((p): p is string => Boolean(p?.trim()))
  return msgs.length ? msgs.join('；') : null
}

async function getEarliestOrderTimeForShop(liveAccountId: string): Promise<Date | null> {
  const agg = await prisma.xhsRawOrder.aggregate({
    where: { liveAccountId },
    _min: { orderTime: true },
  })
  return agg._min.orderTime
}

function resolveScanRangeStart(earliest: Date | null): string {
  if (earliest) return formatDateKeyShanghai(earliest)
  return addDaysShanghai(formatDateKeyShanghai(), -BOSS_BILL_SCAN_FALLBACK_DAYS)
}

async function fetchAllPendingOrdersInWindow(
  shop: GoodReviewShopDefinition,
  startTime: string,
  endTime: string,
): Promise<{ rows: ParsedBossPendingSettleOrder[]; failed: boolean; error?: string }> {
  const body = {
    ...PENDING_LIST_BODY_BASE,
    startTime,
    endTime,
  }
  const dedup = new Map<string, ParsedBossPendingSettleOrder>()
  let pageNum = 1
  let totalPage = 1
  while (pageNum <= totalPage) {
    const res = await fetchBossSettleBillListAudited(shop, { ...body, pageNum }, pageNum)
    if (!res.ok || res.data == null) {
      return { rows: [], failed: true, error: res.errorMessage ?? '待结算明细失败' }
    }
    const parsed = parseBossSettleBillListPage(res.data, shop.shopKey)
    totalPage = parsed.totalPage
    for (const row of parsed.rows) {
      dedup.set(row.platformSettleNo, row)
    }
    pageNum += 1
  }
  return { rows: [...dedup.values()], failed: false }
}

async function fetchPeriodBillsAllPages(
  shop: GoodReviewShopDefinition,
  body: Record<string, unknown>,
  apiName: 'boss_settlement_bill_day' | 'boss_settlement_bill_month',
) {
  const rows = []
  let pageNum = 1
  let totalPage = 1
  while (pageNum <= totalPage) {
    const res = await fetchBossPeriodSettleBillListAudited(
      shop,
      { ...body, pageNum },
      pageNum,
      apiName,
    )
    if (!res.ok || res.data == null) {
      throw new Error(res.errorMessage ?? `${apiName} 失败`)
    }
    const parsed = parseBossPeriodSettleBillPage(res.data)
    totalPage = parsed.totalPage
    rows.push(...parsed.rows)
    pageNum += 1
  }
  return rows
}

async function upsertPeriodBillRows(
  shop: GoodReviewShopDefinition,
  liveAccountId: string,
  rows: ReturnType<typeof parseBossPeriodSettleBillPage>['rows'],
  sourceType: 'official_month' | 'day_aggregate' | 'official_day',
) {
  let written = 0
  const now = new Date()
  for (const row of rows) {
    await prisma.bossSettlementPeriodBill.upsert({
      where: {
        shopKey_periodType_periodStart: {
          shopKey: shop.shopKey,
          periodType: row.periodType,
          periodStart: row.periodStart,
        },
      },
      create: {
        shopKey: shop.shopKey,
        liveAccountId,
        platformBillNo: row.platformBillNo,
        periodType: row.periodType,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        billDate: row.billDate,
        processStatus: row.processStatus,
        settleOrderCount: row.settleOrderCount,
        otherOrderCount: row.otherOrderCount,
        totalCount: row.totalCount,
        totalIncomeCent: row.totalIncomeCent,
        totalOutcomeCent: row.totalOutcomeCent,
        totalChangeCent: row.totalChangeCent,
        totalCommissionCent: row.totalCommissionCent,
        feeDetailJson: JSON.stringify(row.feeDetail),
        sourceType,
        processFinishedAt: row.processFinishedAt,
        fetchedAt: now,
      },
      update: {
        liveAccountId,
        platformBillNo: row.platformBillNo,
        periodEnd: row.periodEnd,
        billDate: row.billDate,
        processStatus: row.processStatus,
        settleOrderCount: row.settleOrderCount,
        otherOrderCount: row.otherOrderCount,
        totalCount: row.totalCount,
        totalIncomeCent: row.totalIncomeCent,
        totalOutcomeCent: row.totalOutcomeCent,
        totalChangeCent: row.totalChangeCent,
        totalCommissionCent: row.totalCommissionCent,
        feeDetailJson: JSON.stringify(row.feeDetail),
        sourceType,
        processFinishedAt: row.processFinishedAt,
        fetchedAt: now,
      },
    })
    written += 1
  }
  return written
}

async function reconcileFundBillForShop(
  shop: GoodReviewShopDefinition,
): Promise<{ status: string; diffCent: number | null }> {
  const monthKey = shanghaiMonthKey()
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  const monthStart = `${startOfMonthKeyShanghai(year, month)} 00:00:00`
  const monthEnd = `${formatDateKeyShanghai()} 23:59:59`

  const res = await fetchBossPeriodFundBillListAudited(
    shop,
    {
      periodType: 'DAY',
      timeType: 'COMPLETE_TIME',
      startTime: monthStart,
      endTime: monthEnd,
      pageNum: 1,
      pageSize: BOSS_BILL_PAGE_SIZE,
    },
    1,
  )
  if (!res.ok || res.data == null) {
    return { status: 'unknown', diffCent: null }
  }
  const parsed = parseBossPeriodFundBillPage(res.data)
  const fundBill = parsed.rows.find((row) => row.totalChangeCent != null) ?? parsed.rows[0]
  if (!fundBill || fundBill.totalChangeCent == null) {
    return { status: 'unknown', diffCent: null }
  }
  const periodStart = fundBill.periodStart
  const periodEnd = fundBill.periodEnd
  const flows = await prisma.bossAccountFlow.findMany({
    where: {
      shopKey: shop.shopKey,
      occurredAt: { gte: periodStart, lte: periodEnd },
    },
    select: { incomeAmountCent: true, outcomeAmountCent: true },
  })
  const localNet = flows.reduce((acc, f) => acc + f.incomeAmountCent - f.outcomeAmountCent, 0)
  const diff = fundBill.totalChangeCent - localNet
  if (Math.abs(diff) <= 1) return { status: 'ok', diffCent: diff }
  return { status: 'reconciliation_warning', diffCent: diff }
}

export async function syncBossBillForShop(shop: GoodReviewShopDefinition): Promise<{
  success: boolean
  partial?: boolean
  pendingSnapshotWritten?: boolean
  pendingOrderCount?: number
  periodBillWrittenCount?: number
  error?: string
}> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) return { success: false, error: '未配置官方账号' }

  const previous = await prisma.bossPendingSettlementSnapshot.findFirst({
    where: { shopKey: shop.shopKey },
    orderBy: { updatedAt: 'desc' },
  })

  const storeRes = await fetchBossBillStoreInfoAudited(shop)
  const storeInfo = storeRes.ok && storeRes.data != null ? parseBossStoreInfo(storeRes.data) : null

  const rangeEndKey = formatDateKeyShanghai()
  const earliest = await getEarliestOrderTimeForShop(account.id)
  const rangeStartKey = resolveScanRangeStart(earliest)
  const windows = buildThirtyDayWindows(
    rangeStartKey,
    rangeEndKey,
    BOSS_BILL_WINDOW_DAYS,
    addDaysShanghai,
  )

  const allOrders = new Map<string, ParsedBossPendingSettleOrder>()
  let officialAmountSum = 0
  let hasOfficialAmount = false
  let lastSellerAccount: number | null = null
  let lastAlipay: number | null = null
  let lastWechat: number | null = null
  const windowErrors: string[] = []

  for (const window of windows) {
    const summaryRes = await fetchBossSellerPreIncomeAudited(shop, {
      ...PENDING_LIST_BODY_BASE,
      startTime: window.startTime,
      endTime: window.endTime,
      pageNum: 1,
    })
    if (!summaryRes.ok || summaryRes.data == null) {
      windowErrors.push(summaryRes.errorMessage ?? '待结算汇总失败')
      continue
    }
    const summary = parseBossSellerPreIncome(summaryRes.data)
    if (summary.allAmountCent != null) {
      officialAmountSum += summary.allAmountCent
      hasOfficialAmount = true
    }
    lastSellerAccount = summary.sellerAccountAmountCent ?? lastSellerAccount
    lastAlipay = summary.alipayAmountCent ?? lastAlipay
    lastWechat = summary.wechatAmountCent ?? lastWechat

    const listResult = await fetchAllPendingOrdersInWindow(shop, window.startTime, window.endTime)
    if (listResult.failed) {
      windowErrors.push(listResult.error ?? '待结算明细失败')
      continue
    }
    for (const row of listResult.rows) {
      allOrders.set(row.platformSettleNo, row)
    }
  }

  if (windowErrors.length > 0) {
    logWarn('老板账单', `${shop.shopName} 待结算扫描未完成：${windowErrors.join('；')}`)
    return {
      success: previous != null,
      partial: true,
      pendingSnapshotWritten: false,
      pendingOrderCount: previous?.pendingOrderCount ?? undefined,
      error: mergeErrors(windowErrors) ?? undefined,
    }
  }

  const detailSumCent = [...allOrders.values()].reduce(
    (acc, row) => acc + (row.sellerIncomeCent ?? 0),
    0,
  )
  const officialAmountCent = hasOfficialAmount ? officialAmountSum : null
  const reconciliation = checkPendingReconciliation(officialAmountCent, detailSumCent)
  const syncStatus = reconciliation.ok ? 'success' : 'reconciliation_warning'

  let periodBillWrittenCount = 0
  let periodBillError: string | null = null
  try {
    const currentMonth = shanghaiMonthKey()
    const [yearStr, monthStr] = currentMonth.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const monthStart = `${startOfMonthKeyShanghai(year, month)} 00:00:00`
    const monthEnd = `${formatDateKeyShanghai()} 23:59:59`

    const dayRows = await fetchPeriodBillsAllPages(
      shop,
      {
        periodType: 'DAY',
        timeType: 'SETTLE_TIME',
        startTime: monthStart,
        endTime: monthEnd,
        pageSize: BOSS_BILL_PAGE_SIZE,
      },
      'boss_settlement_bill_day',
    )
    periodBillWrittenCount += await upsertPeriodBillRows(shop, account.id, dayRows, 'official_day')

    const monthsBack = BOSS_INCOME_MONTHS
    for (let i = 1; i <= monthsBack; i++) {
      let m = month - i
      let y = year
      while (m <= 0) {
        m += 12
        y -= 1
      }
      const mStart = `${startOfMonthKeyShanghai(y, m)} 00:00:00`
      const monthRows = await fetchPeriodBillsAllPages(
        shop,
        {
          periodType: 'MONTH',
          timeType: 'SETTLE_TIME',
          startTime: mStart,
          endTime: mStart,
          pageSize: BOSS_BILL_PAGE_SIZE,
        },
        'boss_settlement_bill_month',
      )
      periodBillWrittenCount += await upsertPeriodBillRows(
        shop,
        account.id,
        monthRows,
        'official_month',
      )
    }
  } catch (err) {
    periodBillError = err instanceof Error ? err.message : String(err)
    logWarn('老板账单', `${shop.shopName} 周期账单同步失败：${periodBillError}`)
  }

  let fundReconcile = { status: 'unknown', diffCent: null as number | null }
  try {
    fundReconcile = await reconcileFundBillForShop(shop)
  } catch (err) {
    logWarn('老板账单', `${shop.shopName} 资金账单核对失败：${err instanceof Error ? err.message : String(err)}`)
  }

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.bossPendingSettlementOrder.updateMany({
      where: { shopKey: shop.shopKey, isCurrent: true },
      data: { isCurrent: false },
    })
    for (const row of allOrders.values()) {
      await tx.bossPendingSettlementOrder.upsert({
        where: {
          shopKey_platformSettleNo: {
            shopKey: shop.shopKey,
            platformSettleNo: row.platformSettleNo,
          },
        },
        create: {
          shopKey: shop.shopKey,
          liveAccountId: account.id,
          platformSettleNo: row.platformSettleNo,
          packageId: row.packageId,
          orderCreateTime: row.orderCreateTime,
          orderStatus: row.orderStatus,
          orderFinishTime: row.orderFinishTime,
          settleStatus: row.settleStatus,
          expectedSettleTime: row.expectedSettleTime,
          transactionType: row.transactionType,
          sellerIncomeCent: row.sellerIncomeCent,
          totalIncomeCent: row.totalIncomeCent,
          totalOutcomeCent: row.totalOutcomeCent,
          platformCommissionCent: row.platformCommissionCent,
          cpsCommissionCent: row.cpsCommissionCent,
          installmentFeeCent: row.installmentFeeCent,
          lastSeenAt: now,
          isCurrent: true,
        },
        update: {
          liveAccountId: account.id,
          packageId: row.packageId,
          orderCreateTime: row.orderCreateTime,
          orderStatus: row.orderStatus,
          orderFinishTime: row.orderFinishTime,
          settleStatus: row.settleStatus,
          expectedSettleTime: row.expectedSettleTime,
          transactionType: row.transactionType,
          sellerIncomeCent: row.sellerIncomeCent,
          totalIncomeCent: row.totalIncomeCent,
          totalOutcomeCent: row.totalOutcomeCent,
          platformCommissionCent: row.platformCommissionCent,
          cpsCommissionCent: row.cpsCommissionCent,
          installmentFeeCent: row.installmentFeeCent,
          lastSeenAt: now,
          isCurrent: true,
        },
      })
    }
    await tx.bossPendingSettlementSnapshot.create({
      data: {
        shopKey: shop.shopKey,
        liveAccountId: account.id,
        pendingAmountCent: officialAmountCent,
        sellerAccountAmountCent: lastSellerAccount,
        alipayAmountCent: lastAlipay,
        wechatAmountCent: lastWechat,
        pendingOrderCount: allOrders.size,
        rangeStart: new Date(`${rangeStartKey}T00:00:00+08:00`),
        rangeEnd: new Date(`${rangeEndKey}T23:59:59+08:00`),
        settlePeriodDays: storeInfo?.settlePeriodDays ?? previous?.settlePeriodDays ?? null,
        syncStatus: periodBillError ? 'partial_success' : syncStatus,
        syncError: mergeErrors([
          !reconciliation.ok ? '待结算明细正在核对' : null,
          periodBillError,
        ]),
        reconciliationDiffCent: reconciliation.diffCent,
        fundReconcileStatus: fundReconcile.status,
        fundReconcileDiffCent: fundReconcile.diffCent,
        fundReconcileCheckedAt: now,
        fetchedAt: now,
      },
    })
  })

  logInfo(
    '老板账单',
    `${shop.shopName} 待结算 ${allOrders.size} 笔 金额=${officialAmountCent ?? 'null'}分 周期账单=${periodBillWrittenCount}`,
  )

  return {
    success: true,
    partial: Boolean(periodBillError) || !reconciliation.ok,
    pendingSnapshotWritten: true,
    pendingOrderCount: allOrders.size,
    periodBillWrittenCount,
    error: mergeErrors([!reconciliation.ok ? '待结算明细正在核对' : null, periodBillError]) ?? undefined,
  }
}
