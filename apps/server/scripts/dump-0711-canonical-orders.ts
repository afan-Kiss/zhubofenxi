/**
 * Dump 0711 order attributions to /tmp/0711-orders.json
 */
import fs from 'node:fs'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { getOrBuildBusinessBoardCache } from '../src/services/business-cache.service'
import { resolveCanonicalOrderAttribution, parseViewOrderCreateTimeMs } from '../src/services/canonical-order-attribution.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { viewCountsAsQualityRefund } from '../src/services/quality-refund-resolution.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { buildAnchorAttributionHealthReport } from '../src/services/anchor-attribution-health.service'
import { prisma } from '../src/lib/prisma'

async function main() {
  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: '2026-07-11',
    endDate: '2026-07-11',
  })
  const cache = await getOrBuildBusinessBoardCache({
    preset: 'custom',
    startDate: '2026-07-11',
    endDate: '2026-07-11',
  })
  const withRaw = attachRawByMatchToViews(cache.views, cache.rawByMatch)
  const orders = []
  for (const v of withRaw) {
    const c = await resolveCanonicalOrderAttribution(v)
    const create = parseViewOrderCreateTimeMs(v)
    const payMs = parseViewPayTimeMs(v)
    orders.push({
      orderNo: resolveMetricOrderNo(v),
      liveAccountName: c.liveAccountName || v.liveAccountName,
      createTime: create.text,
      payTime:
        payMs != null
          ? new Date(payMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
          : null,
      canonicalAnchor: c.canonicalAnchorName,
      attributionType: c.attributionType,
      matchedLiveSessionId: c.matchedLiveSessionId,
      matchedScheduleId: c.matchedScheduleId,
      isQuality: viewCountsAsQualityRefund(v),
      payYuan: (v.paymentBaseCent ?? v.actualPaidCent ?? 0) / 100,
      explain: c.attributionExplain,
    })
  }
  const byShop: Record<string, Record<string, number>> = {}
  for (const o of orders) {
    const shop = String(o.liveAccountName || '?')
    byShop[shop] ??= {}
    byShop[shop][String(o.canonicalAnchor)] = (byShop[shop][String(o.canonicalAnchor)] ?? 0) + 1
  }
  const health = await buildAnchorAttributionHealthReport({
    startDate: '2026-07-01',
    endDate: '2026-07-12',
  })
  const payload = {
    orderCount: orders.length,
    byShop,
    leaderboard: cache.anchorLeaderboard,
    summary: cache.summary,
    orders,
    health: {
      passed: health.passed,
      message: health.message,
      unassignedOrderCount: health.unassignedOrderCount,
      templateDeviationWithoutConfirmCount: health.templateDeviationWithoutConfirmCount,
      scheduleConflictCount: health.scheduleConflictCount,
      shopTotalMismatchCount: health.shopTotalMismatchCount,
      qualityAnchorMismatchCount: health.qualityAnchorMismatchCount,
      qualityCrossAnchorDupCount: health.qualityCrossAnchorDupCount,
      qualityCardDetailMismatchCount: health.qualityCardDetailMismatchCount,
      issues: health.issues,
      attributionAlgorithmVersion: health.attributionAlgorithmVersion,
    },
  }
  fs.writeFileSync('/tmp/0711-orders.json', JSON.stringify(payload, null, 2), 'utf8')
  console.log(JSON.stringify({ orderCount: orders.length, byShop, healthPassed: health.passed, message: health.message }))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
