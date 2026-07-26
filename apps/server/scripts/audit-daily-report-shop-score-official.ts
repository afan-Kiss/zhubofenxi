/**
 * 只读核对：千帆官方总分 vs DB officialOverallScore vs 日报综合分
 * 任一项不一致 → exit 1
 *
 * 用法：
 *   npx tsx apps/server/scripts/audit-daily-report-shop-score-official.ts [reportDate]
 * 默认 reportDate = 今天（上海）或传入如 2026-07-25
 */
import { GOOD_REVIEW_SHOPS } from '../src/config/good-review-shops.constants'
import { DAILY_REPORT_SHOP_SCORE_ORDER } from '../src/services/daily-report-shop-scores.service'
import { loadDailyReportShopScores } from '../src/services/daily-report-shop-scores.service'
import { fetchBossShopScore } from '../src/services/boss-dashboard/boss-dashboard-api.service'
import { parseBossShopScore } from '../src/services/boss-dashboard/boss-dashboard-normalize.service'
import { prisma } from '../src/lib/prisma'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

const reportDate = (process.argv[2] || formatDateKeyShanghai()).trim()

type Row = {
  shopKey: string
  shopName: string
  apiOfficial: number | null
  dbOfficial: number | null
  reportOverall: number | null
  quality: number | null
  logistics: number | null
  service: number | null
  trend: string
  ok: boolean
  reasons: string[]
}

async function main() {
  console.log(`\n=== 店铺体验分官方口径核对 reportDate=${reportDate} ===\n`)

  const reportItems = await loadDailyReportShopScores(reportDate)
  const reportByKey = new Map(reportItems.map((i) => [i.shopKey, i]))

  const rows: Row[] = []

  for (const shopKey of DAILY_REPORT_SHOP_SCORE_ORDER) {
    const shop = GOOD_REVIEW_SHOPS.find((s) => s.shopKey === shopKey)
    if (!shop) throw new Error(`missing shop ${shopKey}`)

    let apiOfficial: number | null = null
    try {
      const data = await fetchBossShopScore(shop)
      apiOfficial = parseBossShopScore(data).officialOverallScore
    } catch (e) {
      console.warn(`[warn] ${shop.shopName} 接口拉取失败:`, e instanceof Error ? e.message : e)
    }

    const db = await prisma.bossShopScoreSnapshot.findFirst({
      where: { shopKey, scoreDate: { lte: reportDate } },
      orderBy: { scoreDate: 'desc' },
    })

    const report = reportByKey.get(shopKey)
    const dbOfficial =
      db?.officialOverallScore != null && Number.isFinite(db.officialOverallScore)
        ? Math.round(db.officialOverallScore * 10) / 10
        : null
    const reportOverall = report?.overallScore ?? null

    const reasons: string[] = []
    if (apiOfficial != null && dbOfficial != null && apiOfficial !== dbOfficial) {
      reasons.push(`DB(${dbOfficial})≠接口(${apiOfficial})`)
    }
    if (apiOfficial != null && reportOverall != null && apiOfficial !== reportOverall) {
      reasons.push(`日报(${reportOverall})≠接口(${apiOfficial})`)
    }
    if (dbOfficial != null && reportOverall != null && dbOfficial !== reportOverall) {
      reasons.push(`日报(${reportOverall})≠DB(${dbOfficial})`)
    }
    if (apiOfficial == null) reasons.push('接口总分缺失')
    if (dbOfficial == null) reasons.push('DB officialOverallScore 缺失')
    if (reportOverall == null) reasons.push('日报综合分缺失')

    // 趋势禁止上升/下降 +0.0
    const trend = report?.overallTrend ?? '—'
    const delta = report?.overallDelta
    if (
      (trend === '上升' || trend === '下降') &&
      delta != null &&
      Math.round(Math.abs(delta) * 10) / 10 === 0
    ) {
      reasons.push(`矛盾趋势 ${trend} +0.0`)
    }

    rows.push({
      shopKey,
      shopName: shop.shopName,
      apiOfficial,
      dbOfficial,
      reportOverall,
      quality: report?.qualityScore ?? null,
      logistics: report?.logisticsScore ?? null,
      service: report?.serviceScore ?? null,
      trend: `${trend}${delta != null && delta !== 0 ? ` ${delta > 0 ? '+' : ''}${delta}` : ''}`,
      ok: reasons.length === 0,
      reasons,
    })
  }

  console.log(
    [
      '店铺'.padEnd(14),
      '接口总分'.padStart(8),
      '数据库'.padStart(8),
      '日报总分'.padStart(8),
      '品质'.padStart(6),
      '物流'.padStart(6),
      '服务'.padStart(6),
      '趋势'.padStart(10),
      '结果',
    ].join(' | '),
  )
  console.log('-'.repeat(100))

  for (const r of rows) {
    console.log(
      [
        r.shopName.padEnd(14),
        String(r.apiOfficial ?? '—').padStart(8),
        String(r.dbOfficial ?? '—').padStart(8),
        String(r.reportOverall ?? '—').padStart(8),
        String(r.quality ?? '—').padStart(6),
        String(r.logistics ?? '—').padStart(6),
        String(r.service ?? '—').padStart(6),
        r.trend.padStart(10),
        r.ok ? 'OK' : `FAIL: ${r.reasons.join('; ')}`,
      ].join(' | '),
    )
  }

  const failed = rows.filter((r) => !r.ok)
  console.log(`\n合计 ${rows.length} 店，失败 ${failed.length}`)
  await prisma.$disconnect()
  if (failed.length) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
