/**
 * 诊断 小红/小艺 按直播场次归属 + 实际签收单
 * 用法: npx tsx apps/server/scripts/diagnose-xiaohong-xiaoyi-sessions.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { getBoardScopedViewsForRange, getAnchorPerformanceViews } from '../src/services/board-scoped-views.service'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import { resolveDailyReportLiveSessionAssignments } from '../src/services/daily-report-live-sessions.service'
import { resolveAnchorLiveSessionsForRange } from '../src/services/anchor-live-sessions.service'
import { viewBelongsToAnchor } from '../src/services/anchor-attribution.util'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import { centToYuan } from '../src/utils/money'
import { addDaysShanghai } from '../src/utils/business-timezone'

config({ path: path.resolve(__dirname, '../.env') })

const START = '2026-06-29'
const END = '2026-07-03'
const ANCHORS = ['小红', '小艺']

function sessionKey(v: import('../src/types/analysis').AnalyzedOrderView): string {
  if (v.matchedLiveStartTime && v.matchedLiveEndTime) {
    return `${v.liveAccountName ?? '—'} | 场次 ${v.matchedLiveStartTime}~${v.matchedLiveEndTime}`
  }
  if (v.matchedRuleName) {
    return `规则 ${v.matchedRuleName} (${v.attributionType}) | ${v.liveAccountName ?? '—'}`
  }
  return `${v.attributionType ?? 'unknown'} | ${v.liveAccountName ?? '—'}`
}

function signedAmountYuan(v: import('../src/types/analysis').AnalyzedOrderView): number {
  const cent =
    v.actualSignAmountCent ??
    v.actualSignedAmountCent ??
    (v.isEffectiveSigned ? v.effectiveGmvCent : 0) ??
    0
  return centToYuan(cent)
}

async function main() {
  const { views, rawByMatch } = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: START,
    endDate: END,
    role: 'boss',
    username: 'admin',
  })
  const perfViews = await getAnchorPerformanceViews(views, rawByMatch)
  const cfg = getAnchorConfigSync()

  console.log(`\n日期范围: ${START} ~ ${END}`)
  console.log('口径: 实际签收（已签收且无售后中/已关闭不计入；商品退款>20元不计入）\n')

  for (const anchorName of ANCHORS) {
    const anchor = cfg.anchors.find((a) => a.name === anchorName)
    if (!anchor) {
      console.log(`未找到主播: ${anchorName}`)
      continue
    }
    const anchorViews = perfViews.filter((v) =>
      viewBelongsToAnchor(v, { anchorId: anchor.id, anchorName }),
    )
    const signed = anchorViews.filter((v) => isEffectiveSignedView(v))
    const totalSignedAmt = signed.reduce((s, v) => s + signedAmountYuan(v), 0)

    console.log(`=== ${anchorName} ===`)
    console.log(`实际签收: ${signed.length} 单，签收金额合计 ¥${totalSignedAmt.toFixed(2)}`)
    console.log(`归属订单总数(含未签收/售后): ${anchorViews.length} 单\n`)

    const bySession = new Map<
      string,
      { count: number; amount: number; orders: string[] }
    >()
    for (const v of signed) {
      const key = sessionKey(v)
      const amt = signedAmountYuan(v)
      const cur = bySession.get(key) ?? { count: 0, amount: 0, orders: [] }
      cur.count += 1
      cur.amount += amt
      cur.orders.push(
        `${v.displayOrderNo || v.packageId} | 支付 ${v.orderTimeText} | ¥${amt.toFixed(2)} | ${v.orderStatusText ?? ''}`,
      )
      bySession.set(key, cur)
    }

    for (const [k, bucket] of [...bySession.entries()].sort(
      (a, b) => b[1].amount - a[1].amount,
    )) {
      console.log(`--- ${k}`)
      console.log(`    签收 ${bucket.count} 单 · ¥${bucket.amount.toFixed(2)}`)
      for (const line of bucket.orders) console.log(`    ${line}`)
    }
    console.log('')
  }

  console.log('=== 每日排班+真实直播场次 (日报归属逻辑) ===')
  let dateKey = START
  while (dateKey <= END) {
    const assignment = await resolveDailyReportLiveSessionAssignments(dateKey)
    for (const name of ANCHORS) {
      const sessions = assignment.byAnchor.get(name) ?? []
      if (sessions.length === 0) {
        console.log(`${dateKey} ${name}: (无匹配场次)`)
        continue
      }
      for (const s of sessions) {
        console.log(
          `${dateKey} ${name} | ${s.sourceShopName}/${s.liveAccountName} | ${s.liveStartTime}~${s.liveEndTime} liveId=${s.liveId}`,
        )
      }
    }
    dateKey = addDaysShanghai(dateKey, 1)
  }

  console.log('\n=== 主播业绩页「直播场次」列表 (custom 6/29~7/3) ===')
  for (const name of ANCHORS) {
    const sessions = await resolveAnchorLiveSessionsForRange({
      preset: 'custom',
      startDate: START,
      endDate: END,
      anchorName: name,
    })
    console.log(`\n${name}: ${sessions.length} 场`)
    for (const s of sessions) {
      console.log(`  ${s.startTime} ~ ${s.endTime} | ${s.liveName} | ${s.durationText}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
