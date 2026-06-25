import { buildDailyReport } from '../src/services/daily-report.service'
import { resolveDailyReportAnchorsForDate } from '../src/services/anchor-performance-attribution.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { getAnchorPerformanceViews } from '../src/services/board-scoped-views.service'
import { remapViewsForAnchorPerformance } from '../src/services/anchor-performance-attribution.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'

async function main() {
  const date = process.argv[2] ?? '2026-06-18'
  const config = getAnchorConfigSync()
  console.log('config anchors:', config.anchors.map((a) => `${a.name}(${a.id})`))
  console.log('report anchors:', resolveDailyReportAnchorsForDate(config, date))

  const scoped = await getBoardScopedViewsForRange({ startDate: date, endDate: date })
  const remapped = remapViewsForAnchorPerformance(
    attachRawByMatchToViews(scoped.views, scoped.rawByMatch),
  )
  const xiaoBaiViews = remapped.filter((v) => v.anchorName === '小白')
  console.log('remapped 小白 orders:', xiaoBaiViews.length)
  if (xiaoBaiViews[0]) {
    console.log('sample:', xiaoBaiViews[0].orderTimeText, xiaoBaiViews[0].anchorId)
  }

  const xbAnchor = resolveDailyReportAnchorsForDate(config, date).find((a) => a.anchorName === '小白')
  if (xbAnchor) {
    const perf = getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      xbAnchor.anchorId,
      xbAnchor.anchorName,
    )
    console.log('getAnchorPerformanceViews 小白:', perf.length)
  }

  const report = await buildDailyReport({ startDate: date, endDate: date })
  console.log('daily report rows:', report.anchors.map((a) => a.anchorName))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
