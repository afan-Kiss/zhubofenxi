/**
 * 买家排行低价刷单过滤验收
 * 运行：npx tsx apps/server/scripts/dev/verify-buyer-low-price-filter.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { prepareAnalysisArtifactsFromRaw } from '../../src/services/business-analysis.service'
import { buildRawAnalyzeBundleAll } from '../../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import {
  attachRawByMatchToViews,
  filterViewsForBuyerRanking,
  isLowPriceBrushOrderView,
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
  resolveUnitPriceCentForBrushCheck,
} from '../../src/services/low-price-brush-order.service'
import {
  buildBuyerRankingSummaryFromViews,
  type BuyerRankingItem,
} from '../../src/services/buyer-ranking.service'
import {
  BUYER_RANKING_CACHE_VERSION,
  getBuyerRankingProfile,
  rebuildBuyerRankingCache,
  isBuyerRankingCacheVersionCurrent,
  isBuyerRankingCacheRebuilding,
  parseBuyerRankingCacheVersionFromRow,
} from '../../src/services/buyer-ranking-cache.service'
import { buildBuyerProfileDrill } from '../../src/services/board-drill.service'
import { viewMatchesBuyerKey } from '../../src/services/buyer-identity.service'

config({ path: path.resolve(__dirname, '../../.env') })

const prisma = new PrismaClient()

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

async function waitForBuyerRankingRebuild(timeoutMs = 180_000): Promise<void> {
  const start = Date.now()
  while (isBuyerRankingCacheRebuilding()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('买家排行缓存重建超时')
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

function buyerKeyFromItem(item: BuyerRankingItem): string {
  return String(item.buyerKey ?? item.buyerId ?? '').trim()
}

async function main(): Promise<void> {
  console.log('\n=== 买家排行低价刷单过滤验收 ===\n')
  console.log(`期望缓存版本: ${BUYER_RANKING_CACHE_VERSION}\n`)

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle || bundle.orders.length === 0) {
    console.error('❌ 本地无订单数据，无法验收')
    process.exit(1)
  }

  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const allViewsWithRaw = attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch)
  const lowPriceViews = allViewsWithRaw.filter((v) => isLowPriceBrushOrderView(v))
  const buyerRankingViews = filterViewsForBuyerRanking(allViewsWithRaw)

  const lowPriceBuyerKeys = new Set<string>()
  const normalOrderBuyerKeys = new Set<string>()
  for (const v of allViewsWithRaw) {
    const bk = String(v.buyerKey ?? v.buyerId ?? '').trim()
    if (!bk) continue
    if (isLowPriceBrushOrderView(v)) lowPriceBuyerKeys.add(bk)
    else normalOrderBuyerKeys.add(bk)
  }
  const onlyLowPriceBuyerKeys = [...lowPriceBuyerKeys].filter((k) => !normalOrderBuyerKeys.has(k))

  const { items: computedItems, summary: computedSummary } =
    buildBuyerRankingSummaryFromViews(buyerRankingViews)

  const cacheRow = await prisma.buyerRankingCache.findUnique({ where: { id: 'default' } })
  const cacheVersion = parseBuyerRankingCacheVersionFromRow(cacheRow)
  const needsRebuild =
    envFlag('BUYER_LOW_PRICE_FORCE_REBUILD') ||
    !cacheRow ||
    !isBuyerRankingCacheVersionCurrent(cacheVersion)

  if (needsRebuild) {
    console.log('缓存版本不匹配或强制重建，正在重建买家排行缓存…')
    if (isBuyerRankingCacheRebuilding()) {
      console.log('检测到进行中的重建任务，等待完成…')
      await waitForBuyerRankingRebuild()
    } else {
      await rebuildBuyerRankingCache('verify_low_price_filter')
    }
  }

  const profile = await getBuyerRankingProfile()
  const items = profile?.items ?? computedItems
  const summary = profile?.summary ?? computedSummary
  const sampleOrderCount = profile?.sampleMeta?.sampleOrderCount ?? profile?.orderCount ?? 0

  console.log(`缓存版本: ${profile?.cacheVersion ?? (cacheVersion || 'none')}`)
  console.log(`低价订单数（过滤前）: ${lowPriceViews.length}`)
  console.log(`低价买家数（仅低价订单）: ${onlyLowPriceBuyerKeys.length}`)
  console.log(`过滤后样本订单数: ${sampleOrderCount}`)
  console.log(`过滤后买家条目数: ${items.length}`)
  console.log(
    `过滤后汇总 — 高价值: ${summary.highValueCount} · 复购: ${summary.repurchaseCount} · 退款: ${summary.refundCount} · 品退: ${summary.qualityHeavyCount}`,
  )

  let failed = false

  for (const key of onlyLowPriceBuyerKeys) {
    const hit = items.find((i) => buyerKeyFromItem(i) === key)
    if (hit) {
      failed = true
      console.error(
        `❌ 仅低价订单买家仍出现在排行: ${hit.nickname ?? hit.buyerDisplayName ?? key} (buyerKey=${key})`,
      )
    }
  }

  const repurchaseLowEarned = items.filter(
    (i) =>
      Number(i.orderCount ?? 0) >= 2 &&
      Number(i.displayEarnedAmountCent ?? i.earnedAmount * 100 ?? 0) > 0 &&
      onlyLowPriceBuyerKeys.includes(buyerKeyFromItem(i)),
  )
  if (repurchaseLowEarned.length > 0) {
    failed = true
    for (const i of repurchaseLowEarned) {
      console.error(
        `❌ 疑似低价刷单复购客户仍在榜: ${i.nickname ?? i.buyerDisplayName} earned=${i.earnedAmount} orders=${i.orderCount}`,
      )
    }
  }

  const drillSample = items.slice(0, Math.min(30, items.length))
  let drawerLowPriceRows = 0
  for (const item of drillSample) {
    const buyerKey = buyerKeyFromItem(item)
    if (!buyerKey) continue
    const drill = await buildBuyerProfileDrill({ buyerKey, buyerId: buyerKey, pageSize: 100 })
    const buyerViews = buyerRankingViews.filter((v) => viewMatchesBuyerKey(v, buyerKey))
    for (const row of drill.rows ?? []) {
      const orderNo = String(row.orderNo ?? row.displayOrderNo ?? '').trim()
      const view = buyerViews.find(
        (v) =>
          String(v.displayOrderNo ?? v.officialOrderNo ?? v.packageId ?? '').trim() === orderNo,
      )
      if (!view) continue
      const unitCent = resolveUnitPriceCentForBrushCheck(view)
      if (unitCent > 0 && unitCent < LOW_PRICE_BRUSH_THRESHOLD_CENT) {
        drawerLowPriceRows += 1
        failed = true
        console.error(
          `❌ Drawer 含低价订单: buyer=${item.nickname ?? buyerKey} order=${orderNo} unitPriceCent=${unitCent}`,
        )
      }
    }
  }

  if (drawerLowPriceRows === 0) {
    console.log(`✓ Drawer 抽样 ${drillSample.length} 位买家，未发现 unitPriceCent < ${LOW_PRICE_BRUSH_THRESHOLD_CENT} 的订单`)
  }

  if (profile?.sampleMeta?.sampleDescription?.includes('¥20.00')) {
    console.log('✓ sampleDescription 已包含低价排除说明')
  } else {
    failed = true
    console.error('❌ sampleDescription 缺少低价排除说明')
  }

  if (sampleOrderCount !== buyerRankingViews.length && buyerRankingViews.length > 0) {
    console.warn(
      `⚠ sampleOrderCount(${sampleOrderCount}) 与过滤后 view 数(${buyerRankingViews.length}) 不完全一致（可能因订单号去重口径）`,
    )
  }

  if (failed) {
    console.error('\n验收失败：低价刷单订单仍进入买家排行或 Drawer\n')
    process.exit(1)
  }

  console.log('\n✅ 买家排行低价刷单过滤验收通过\n')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
