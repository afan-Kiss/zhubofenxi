/**
 * 生产验收：0711 归属 + 健康报告（UTF-8 JSON）
 * npx tsx apps/server/scripts/accept-canonical-prod-report.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/lib/prisma'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import {
  resolveCanonicalOrderAttribution,
  parseViewOrderCreateTimeMs,
  CANONICAL_ATTRIBUTION_VERSION,
} from '../src/services/canonical-order-attribution.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { viewCountsAsQualityRefund } from '../src/services/quality-refund-resolution.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { buildAnchorAttributionHealthReport } from '../src/services/anchor-attribution-health.service'
import { buildAnchorQualityRefundDrill } from '../src/services/board-drill.service'

function hm(d: Date): string {
  return d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

async function main(): Promise<void> {
  const scheduleRows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: '2026-07-11', enabled: true },
    orderBy: { startAt: 'asc' },
  })

  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: '2026-07-11',
    endDate: '2026-07-11',
  })
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: '2026-07-11',
    endDate: '2026-07-11',
    role: 'super_admin',
    username: 'canonical-accept',
  })
  const withRaw = attachRawByMatchToViews(local.views ?? [], local.rawByMatch ?? new Map())

  const orders: Array<Record<string, unknown>> = []
  const byShop: Record<string, { total: number; byAnchor: Record<string, number> }> = {}
  let qualityMismatch = 0
  let qualityCount = 0

  for (const v of withRaw) {
    const c = await resolveCanonicalOrderAttribution(v)
    const create = parseViewOrderCreateTimeMs(v)
    const payMs = parseViewPayTimeMs(v)
    const isQr = viewCountsAsQualityRefund(v)
    if (isQr) {
      qualityCount += 1
      if (c.canonicalAnchorName !== c.canonicalAnchorName) qualityMismatch += 1
    }
    const shop = c.liveAccountName || v.liveAccountName || '?'
    byShop[shop] ??= { total: 0, byAnchor: {} }
    byShop[shop].total += 1
    byShop[shop].byAnchor[c.canonicalAnchorName] =
      (byShop[shop].byAnchor[c.canonicalAnchorName] ?? 0) + 1

    orders.push({
      orderNo: resolveMetricOrderNo(v),
      liveAccountName: shop,
      createTime: create.text,
      payTime:
        payMs != null
          ? new Date(payMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
          : null,
      canonicalAnchor: c.canonicalAnchorName,
      attributionType: c.attributionType,
      matchedLiveSessionId: c.matchedLiveSessionId,
      matchedScheduleId: c.matchedScheduleId,
      isQuality: isQr,
      explain: c.attributionExplain,
    })
  }

  // quality drawer vs card
  const leaderboard = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>
  const cardDetail: Array<Record<string, unknown>> = []
  let qualityCrossDup = 0
  const owners = new Map<string, string>()
  for (const row of leaderboard) {
    const anchorName = String(row.anchorName ?? '')
    const cardCount = Number(row.qualityReturnCount ?? 0)
    const drawer = await buildAnchorQualityRefundDrill({
      preset: 'custom',
      startDate: '2026-07-11',
      endDate: '2026-07-11',
      anchorName,
      page: 1,
      pageSize: 100,
      role: 'super_admin',
      username: 'canonical-accept',
    })
    const total = drawer.pagination?.total ?? 0
    cardDetail.push({ anchorName, cardCount, drawerTotal: total, match: cardCount === total })
    for (const r of drawer.rows ?? []) {
      const rec = r as Record<string, unknown>
      const orderNo = String(rec.orderNo ?? '')
      const qAnchor = String(rec.qualityAttributionAnchorName ?? '')
      const pAnchor = String(rec.paymentAnchorName ?? '')
      if (orderNo && qAnchor && pAnchor && qAnchor !== pAnchor) qualityMismatch += 1
      if (!orderNo) continue
      const prev = owners.get(orderNo)
      if (prev && prev !== anchorName) qualityCrossDup += 1
      else owners.set(orderNo, anchorName)
    }
  }

  const health = await buildAnchorAttributionHealthReport({
    startDate: '2026-07-01',
    endDate: '2026-07-12',
  })

  const report = {
    generatedAt: new Date().toISOString(),
    attributionAlgorithmVersion: CANONICAL_ATTRIBUTION_VERSION,
    schedule0711: scheduleRows.map((r) => ({
      id: r.id,
      anchorName: r.anchorName,
      shopName: r.shopName,
      start: hm(r.startAt),
      end: hm(r.endAt),
      confirmed: r.confirmed,
      note: r.note,
      confirmNote: r.confirmNote,
    })),
    orders0711Count: orders.length,
    orders0711: orders,
    byShop0711: byShop,
    leaderboard0711: leaderboard.map((r) => ({
      anchorName: r.anchorName,
      orderCount: r.orderCount,
      qualityReturnCount: r.qualityReturnCount,
      gmv: r.gmv ?? r.totalGmv,
      actualSignedAmount: r.actualSignedAmount,
      returnAmount: r.returnAmount,
    })),
    summary0711: local.summary,
    qualityCardDetail0711: cardDetail,
    qualityCount0711: qualityCount,
    qualityMismatchCount: qualityMismatch,
    qualityCrossDupCount: qualityCrossDup,
    health0701to0712: health,
  }

  const outPath = path.resolve(process.cwd(), 'canonical-prod-accept-report.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(JSON.stringify({
    wrote: outPath,
    scheduleCount: scheduleRows.length,
    orders0711: orders.length,
    byShop0711: byShop,
    healthPassed: health.passed,
    healthMessage: health.message,
    qualityMismatch,
    qualityCrossDup,
  }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
