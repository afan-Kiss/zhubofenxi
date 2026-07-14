/**
 * 只读诊断：小白 2026-06-18～06-30 午场归属差额
 * 禁止写库。运行：npx tsx scripts/diagnose-xiaobai-june-performance.ts
 */
import { prisma } from '../src/lib/prisma'
import { refreshAnchorConfigCache } from '../src/services/anchor.service'
import { loadBoardArtifactsForRange } from '../src/services/board-metrics.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import {
  remapViewsWithCanonicalAttribution,
  resolveCanonicalOrderAttribution,
  parseViewOrderCreateTimeMs,
  CANONICAL_ATTRIBUTION_VERSION,
} from '../src/services/canonical-order-attribution.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { normalizeShopSessionKey } from '../src/services/anchor-performance-attribution.service'
import { isInXiaoBaiOrderSlot } from '../src/services/anchor-xiaobai-slot.util'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { ensureManualAnchorOverrideCache } from '../src/services/order-anchor-manual-override.service'

const START = '2026-06-18'
const END = '2026-06-30'
const SLOT_START = '14:30'
const SLOT_END = '18:00'

function yuan(cent: number): string {
  return (cent / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function isXiangYu(name: string): boolean {
  return normalizeShopSessionKey(name) === 'xiangyu'
}

function inJuneAfternoonSlot(createMs: number): boolean {
  if (!Number.isFinite(createMs)) return false
  const dateKey = formatDateKeyShanghai(new Date(createMs))
  if (dateKey < START || dateKey > END) return false
  return isInXiaoBaiOrderSlot(new Date(createMs))
}

async function main() {
  console.log('=== diagnose-xiaobai-june-performance (readonly) ===')
  console.log(`range: ${START} ~ ${END}  slot: [${SLOT_START}, ${SLOT_END})`)
  console.log(`CANONICAL_ATTRIBUTION_VERSION=${CANONICAL_ATTRIBUTION_VERSION}`)
  console.log('')

  await refreshAnchorConfigCache()
  await ensureManualAnchorOverrideCache()

  // 采样有效排班 vs 已确认排班
  for (const day of [START, '2026-06-20', END]) {
    const table = await getEffectiveScheduleTableForDate(day)
    const xb = table.rows.filter((r) => r.anchorName === '小白')
    const confirmedCount = await prisma.anchorDailySchedule.count({
      where: { scheduleDate: day, enabled: true, confirmed: true, anchorName: '小白' },
    })
    console.log(
      `[schedule ${day}] confirmed=${table.confirmed} effective小白=${xb.length} dbConfirmed小白=${confirmedCount} sources=${table.sourceSummary}`,
    )
    for (const r of xb) {
      console.log(
        `  小白 row source=${r.source} ${r.startTime}-${r.endTime} shop=${r.shopName} room=${r.liveRoomName}`,
      )
    }
  }
  console.log('')

  const { views, rawByMatch } = await loadBoardArtifactsForRange('custom', START, END)
  const withRaw = attachRawByMatchToViews(views, rawByMatch)
  const core = filterViewsForCoreMetrics(withRaw)

  type Row = {
    orderNo: string
    createTime: string
    payTime: string
    liveAccountName: string
    paymentBaseCent: number
    orderStatusText: string
    actualSignAmountCent: number
    isEffectiveSigned: boolean
    canonicalAnchorName: string
    canonicalAttributionType: string
    attributionExplain: string
    matchedLiveSessionId: string | null
    matchedScheduleId: string | null
    expectXiaobaiAfternoon: boolean
    missReason: string
  }

  const afternoonPool: typeof core = []
  for (const v of core) {
    if (!v.includedInGmv) continue
    const live =
      (v.liveAccountName ?? '').trim() ||
      String((v.raw as Record<string, unknown> | undefined)?.liveAccountName ?? '').trim()
    if (!isXiangYu(live)) continue
    const create = parseViewOrderCreateTimeMs(v)
    if (create.ms == null || !inJuneAfternoonSlot(create.ms)) continue
    afternoonPool.push(v)
  }

  await ensureManualAnchorOverrideCache()
  const remapped = await remapViewsWithCanonicalAttribution(afternoonPool)

  let totalCent = 0
  let xiaobaiN = 0
  let xiaobaiCent = 0
  let zijieN = 0
  let zijieCent = 0
  let otherN = 0
  let otherCent = 0
  let unassignedN = 0
  let unassignedCent = 0
  let signedN = 0
  let signedCent = 0
  let excludeNotSignedCent = 0
  let excludeRefundThresholdCent = 0
  let missingCreateTimeCent = 0
  let liveMatchFailCent = 0
  let noSessionNoTemplateCent = 0

  const missRows: Row[] = []
  const detailRows: Row[] = []

  for (let i = 0; i < afternoonPool.length; i++) {
    const v = afternoonPool[i]!
    const remappedV = remapped[i]!
    const create = parseViewOrderCreateTimeMs(v)
    const payMs = parseViewPayTimeMs(v)
    const live =
      (v.liveAccountName ?? '').trim() ||
      String((v.raw as Record<string, unknown> | undefined)?.liveAccountName ?? '').trim()
    const canonical = await resolveCanonicalOrderAttribution(v)
    const name = canonical.canonicalAnchorName || '未归属'
    const cent = v.paymentBaseCent ?? 0
    totalCent += cent

    if (name === '小白') {
      xiaobaiN++
      xiaobaiCent += cent
      if (isEffectiveSignedView(remappedV)) {
        signedN++
        signedCent += remappedV.actualSignAmountCent ?? remappedV.actualSignedAmountCent ?? 0
      } else {
        excludeNotSignedCent += cent
        const refund = remappedV.productRefundAmountCent ?? remappedV.successfulRefundAmountCent ?? 0
        if (refund > 0) excludeRefundThresholdCent += cent
      }
    } else if (name === '子杰') {
      zijieN++
      zijieCent += cent
    } else if (name === '未归属') {
      unassignedN++
      unassignedCent += cent
    } else {
      otherN++
      otherCent += cent
    }

    let missReason = ''
    if (create.ms == null) {
      missingCreateTimeCent += cent
      missReason = '缺少下单时间'
    } else if (!live) {
      liveMatchFailCent += cent
      missReason = '直播号为空'
    } else if (
      name !== '小白' &&
      (canonical.attributionType === 'unassigned' || canonical.attributionType === 'conflict')
    ) {
      noSessionNoTemplateCent += cent
      missReason = `未命中场次且未走模板：${canonical.attributionExplain}`
    } else if (name !== '小白') {
      missReason = `错归 ${name}：${canonical.attributionExplain}`
    }

    const row: Row = {
      orderNo: resolveMetricOrderNo(v) || v.displayOrderNo || v.orderId,
      createTime: create.text,
      payTime:
        payMs != null
          ? new Date(payMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
          : '—',
      liveAccountName: live,
      paymentBaseCent: cent,
      orderStatusText: v.orderStatusText ?? '',
      actualSignAmountCent: remappedV.actualSignAmountCent ?? remappedV.actualSignedAmountCent ?? 0,
      isEffectiveSigned: isEffectiveSignedView(remappedV),
      canonicalAnchorName: name,
      canonicalAttributionType: canonical.attributionType,
      attributionExplain: canonical.attributionExplain,
      matchedLiveSessionId: canonical.matchedLiveSessionId,
      matchedScheduleId: canonical.matchedScheduleId,
      expectXiaobaiAfternoon: true,
      missReason,
    }
    detailRows.push(row)
    if (name !== '小白') missRows.push(row)
  }

  // 全量 remap 后小白池（含非午场）用于对照卡片口径：仅报告 6/18-6/30 支付日?
  // 本诊断仅午场 expect 池
  const xiaobaiViews = remapped.filter((v) => (v.anchorName ?? '') === '小白')
  const xbMetrics = calculateBusinessMetrics(xiaobaiViews)

  console.log('--- 汇总（祥钰系 × 06-18~06-30 × 14:30-18:00 下单 × includedInGmv）---')
  console.log(`1. 祥钰系午场订单总数: ${afternoonPool.length}`)
  console.log(`2. 祥钰系午场支付 GMV: ¥${yuan(totalCent)}`)
  console.log(`3. canonical→小白: ${xiaobaiN} 单 / ¥${yuan(xiaobaiCent)}`)
  console.log(`4. canonical→子杰: ${zijieN} 单 / ¥${yuan(zijieCent)}`)
  console.log(`5. canonical→其他: ${otherN} 单 / ¥${yuan(otherCent)}`)
  console.log(`6. canonical→未归属: ${unassignedN} 单 / ¥${yuan(unassignedCent)}`)
  console.log(`7. 小白已签收订单数(午场池): ${signedN}`)
  console.log(`8. 小白已签收金额(午场池): ¥${yuan(signedCent)}`)
  console.log(`9. 因未有效签收排除金额(归小白但未签收池支付基数): ¥${yuan(excludeNotSignedCent)}`)
  console.log(`10. 因售后处理中排除: （见明细 isEffectiveSigned）`)
  console.log(`11. 因退款相关排除金额(归小白且有退款的支付基数近似): ¥${yuan(excludeRefundThresholdCent)}`)
  console.log(`12. 缺少下单时间金额: ¥${yuan(missingCreateTimeCent)}`)
  console.log(`13. 直播号匹配失败金额: ¥${yuan(liveMatchFailCent)}`)
  console.log(`14. 未命中场次且未走模板丢失金额: ¥${yuan(noSessionNoTemplateCent)}`)
  console.log('')
  console.log(
    `午场池 remap 后小白 calculateBusinessMetrics: GMV=¥${xbMetrics.totalGmv.toFixed(2)} signed=¥${xbMetrics.actualSignedAmount.toFixed(2)} signedN=${xbMetrics.signedOrderCount}`,
  )
  console.log(`错归/未归小白订单数: ${missRows.length} / ¥${yuan(missRows.reduce((s, r) => s + r.paymentBaseCent, 0))}`)
  console.log('')

  console.log('--- 未归小白的午场订单（最多 80 条）---')
  for (const r of missRows.slice(0, 80)) {
    console.log(
      [
        r.orderNo,
        `create=${r.createTime}`,
        `pay=${r.payTime}`,
        `live=${r.liveAccountName}`,
        `payCent=${r.paymentBaseCent}`,
        `status=${r.orderStatusText}`,
        `signCent=${r.actualSignAmountCent}`,
        `effSigned=${r.isEffectiveSigned}`,
        `canon=${r.canonicalAnchorName}`,
        `type=${r.canonicalAttributionType}`,
        `liveId=${r.matchedLiveSessionId ?? '-'}`,
        `schedId=${r.matchedScheduleId ?? '-'}`,
        `explain=${r.attributionExplain}`,
        `miss=${r.missReason}`,
      ].join(' | '),
    )
  }
  if (missRows.length > 80) console.log(`... +${missRows.length - 80} more`)

  // type 分布
  const byType = new Map<string, { n: number; cent: number }>()
  for (const r of detailRows) {
    const k = `${r.canonicalAnchorName}/${r.canonicalAttributionType}`
    const cur = byType.get(k) ?? { n: 0, cent: 0 }
    cur.n++
    cur.cent += r.paymentBaseCent
    byType.set(k, cur)
  }
  console.log('\n--- 归属分布 ---')
  for (const [k, v] of [...byType.entries()].sort((a, b) => b[1].cent - a[1].cent)) {
    console.log(`  ${k}: ${v.n} 单 / ¥${yuan(v.cent)}`)
  }

  console.log('\nDONE (readonly)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
