/**
 * 只读诊断：2026-06「未归属 / 自然流散客」订单
 *
 * START_DATE=2026-06-01 END_DATE=2026-06-30 \
 *   npx tsx apps/server/scripts/diagnose-june-unassigned-anchor.ts
 *
 * 禁止写库 / 改排班 / 清缓存。
 */
import { prisma } from '../src/lib/prisma'
import { ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE } from '../src/config/anchor-schedule.constants'
import { refreshAnchorConfigCache, isAutoAttributableAnchorName } from '../src/services/anchor.service'
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
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { resolveDailyReportLiveSessionAssignments } from '../src/services/daily-report-live-sessions.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { ensureManualAnchorOverrideCache } from '../src/services/order-anchor-manual-override.service'
import { matchTimeRule } from '../src/services/anchor-rules.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import { isShopOrInvalidAnchorLabel } from '../src/utils/anchor-label'
import type { AnalyzedOrderView } from '../src/types/analysis'

const START = (process.env.START_DATE ?? '2026-06-01').trim()
const END = (process.env.END_DATE ?? '2026-06-30').trim()
const FOCUS_DAY = '2026-06-26'

type FailReason =
  | 'missing_create_time'
  | 'missing_live_account'
  | 'live_account_name_mismatch'
  | 'no_real_live_session'
  | 'real_session_exists_but_unassigned'
  | 'order_outside_session'
  | 'no_effective_schedule'
  | 'no_confirmed_schedule'
  | 'multiple_anchor_conflict'
  | 'historical_rule_missing'
  | 'cache_stale'
  | 'other'

function yuan(cent: number): string {
  return `¥${(cent / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function addDay(dateKey: string): string {
  const ms = Date.parse(`${dateKey}T12:00:00+08:00`) + 86_400_000
  return formatDateKeyShanghai(new Date(ms))
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDay(d)) out.push(d)
  return out
}

function classifyFailReason(params: {
  createMs: number | null
  liveAccountName: string
  explain: string
  conflictReason: string | null
  hasShopSessions: boolean
  matchedSchedule: boolean
  originalAnchorName: string
  dateKey: string | null
}): FailReason {
  const explain = params.explain || ''
  if (params.createMs == null) return 'missing_create_time'
  if (!params.liveAccountName.trim()) return 'missing_live_account'
  if (explain.includes('多个主播') || params.conflictReason?.includes('多个主播')) {
    return 'multiple_anchor_conflict'
  }
  if (explain.includes('未命中该直播号真实场次') && params.hasShopSessions) {
    return 'order_outside_session'
  }
  if (explain.includes('无真实场次') || explain.includes('无有效排班')) {
    if (!params.hasShopSessions && !params.matchedSchedule) {
      if (
        params.dateKey &&
        params.dateKey < ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE &&
        params.originalAnchorName &&
        params.originalAnchorName !== '未归属'
      ) {
        return 'historical_rule_missing'
      }
      return params.hasShopSessions ? 'real_session_exists_but_unassigned' : 'no_real_live_session'
    }
    if (!params.matchedSchedule) return 'no_effective_schedule'
  }
  if (explain.includes('已确认排班') || explain.includes('无已确认')) return 'no_confirmed_schedule'
  if (params.hasShopSessions && !params.matchedSchedule) return 'real_session_exists_but_unassigned'
  if (!params.hasShopSessions) return 'no_real_live_session'
  return 'other'
}

function isKeepableLegacyAnchor(name: string): boolean {
  const n = name.trim()
  if (!n || n === '未归属') return false
  if (isShopOrInvalidAnchorLabel(n)) return false
  return isAutoAttributableAnchorName(n)
}

async function main() {
  console.log('=== diagnose-june-unassigned-anchor (readonly) ===')
  console.log(`range: ${START} ~ ${END}`)
  console.log(`CANONICAL_ATTRIBUTION_VERSION=${CANONICAL_ATTRIBUTION_VERSION}`)
  console.log(`ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE=${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE}`)
  console.log('')

  await refreshAnchorConfigCache()
  await ensureManualAnchorOverrideCache()
  const config = getAnchorConfigSync()

  // --- Phase 2: per-day session / schedule inventory ---
  console.log('=== Phase2: daily live sessions & effective schedule ===')
  for (const day of eachDay(START, END)) {
    const rawSessionCount = await prisma.xhsRawLiveSession.count({
      where: {
        startTime: {
          gte: new Date(`${day}T00:00:00+08:00`),
          lt: new Date(`${addDay(day)}T00:00:00+08:00`),
        },
      },
    })
    const table = await getEffectiveScheduleTableForDate(day)
    const assignment = await resolveDailyReportLiveSessionAssignments(day)
    const preCutoff = day < ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE
    console.log(
      `[${day}] rawSessions=${rawSessionCount} assigned=${assignment.assignedSessions.length} unassigned=${assignment.unassignedSessions.length} scheduleRows=${table.rows.length} confirmed=${table.confirmed} pre613=${preCutoff} sources=${JSON.stringify(table.sourceSummary)}`,
    )
    if (assignment.unassignedSessions.length && (preCutoff || day === FOCUS_DAY)) {
      for (const s of assignment.unassignedSessions.slice(0, 6)) {
        console.log(
          `  unassignedSession shop=${s.sourceShopName} ${s.startTime}~${s.endTime} reason=${(s as { unmatchedReason?: string }).unmatchedReason ?? '—'}`,
        )
      }
    }
    if (preCutoff || day === FOCUS_DAY) {
      for (const r of table.rows.slice(0, 8)) {
        console.log(
          `  schedule ${r.anchorName} ${r.startTime}-${r.endTime} ${r.shopName} src=${r.source}`,
        )
      }
    }
  }
  console.log('')

  const { views, rawByMatch } = await loadBoardArtifactsForRange('custom', START, END)
  const withRaw = attachRawByMatchToViews(views, rawByMatch)
  const core = filterViewsForCoreMetrics(withRaw).filter((v) => v.includedInGmv)

  type Row = {
    orderNo: string
    packageId: string
    createTime: string
    payTime: string
    liveAccountId: string
    liveAccountName: string
    originalAnchorId: string
    originalAnchorName: string
    canonicalAnchorId: string
    canonicalAnchorName: string
    canonicalAttributionType: string
    attributionExplain: string
    matchedLiveSessionId: string | null
    matchedScheduleId: string | null
    paymentBaseCent: number
    orderStatusText: string
    actualSignAmountCent: number
    isEffectiveSigned: boolean
    refundCent: number
    dateKey: string | null
    failReason: FailReason
    hasShopSessions: boolean
    timeRuleHint: string
    legacyKeepable: boolean
  }

  const unassigned: Row[] = []
  let totalGmv = 0
  let originalButOverwritten = 0
  let originalButOverwrittenGmv = 0

  for (const v of core) {
    totalGmv += v.paymentBaseCent ?? 0
    const create = parseViewOrderCreateTimeMs(v)
    const payMs = parseViewPayTimeMs(v)
    const canonical = await resolveCanonicalOrderAttribution(v)
    const originalName = (v.anchorName ?? '').trim() || '未归属'
    const originalId = (v.anchorId ?? '').trim()
    const dateKey = create.ms != null ? formatDateKeyShanghai(new Date(create.ms)) : null

    if (canonical.canonicalAnchorName !== '未归属') continue

    // Probe: does shop have assigned sessions that day?
    let hasShopSessions = false
    if (dateKey && (v.liveAccountName ?? '').trim()) {
      const assignment = await resolveDailyReportLiveSessionAssignments(dateKey)
      hasShopSessions = assignment.assignedSessions.some(
        (s) =>
          (s.sourceShopName && (v.liveAccountName ?? '').includes(s.sourceShopName.slice(0, 2))) ||
          (s.liveAccountName &&
            (v.liveAccountName ?? '').includes(s.liveAccountName.slice(0, 2))),
      )
      // broader: any sessions for shops that day (assigned or not)
      const anySessions =
        assignment.assignedSessions.length + assignment.unassignedSessions.length > 0
      if (anySessions) {
        const shopHit = [...assignment.assignedSessions, ...assignment.unassignedSessions].some(
          (s) => {
            const a = (v.liveAccountName ?? '').trim()
            return (
              a.includes('祥钰') && (s.sourceShopName.includes('祥钰') || s.liveAccountName.includes('祥钰'))
            ) ||
              (a.includes('雅玉') && s.sourceShopName.includes('雅玉')) ||
              (a.includes('拾玉') && s.sourceShopName.includes('拾玉'))
          },
        )
        hasShopSessions = shopHit
      }
    }

    const timeRule =
      create.ms != null ? matchTimeRule(new Date(create.ms), config) : null
    const legacyKeepable = isKeepableLegacyAnchor(originalName)
    if (legacyKeepable) {
      originalButOverwritten++
      originalButOverwrittenGmv += v.paymentBaseCent ?? 0
    }

    const failReason = classifyFailReason({
      createMs: create.ms,
      liveAccountName: v.liveAccountName ?? '',
      explain: canonical.attributionExplain,
      conflictReason: canonical.conflictReason,
      hasShopSessions,
      matchedSchedule: Boolean(canonical.matchedScheduleId),
      originalAnchorName: originalName,
      dateKey,
    })

    unassigned.push({
      orderNo: resolveMetricOrderNo(v),
      packageId: String(v.packageId ?? v.raw?.packageId ?? ''),
      createTime: create.text,
      payTime:
        payMs != null
          ? new Date(payMs).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
          : '—',
      liveAccountId: v.liveAccountId ?? '',
      liveAccountName: v.liveAccountName ?? '',
      originalAnchorId: originalId,
      originalAnchorName: originalName,
      canonicalAnchorId: canonical.canonicalAnchorId,
      canonicalAnchorName: canonical.canonicalAnchorName,
      canonicalAttributionType: canonical.attributionType,
      attributionExplain: canonical.attributionExplain,
      matchedLiveSessionId: canonical.matchedLiveSessionId,
      matchedScheduleId: canonical.matchedScheduleId,
      paymentBaseCent: v.paymentBaseCent ?? 0,
      orderStatusText: v.orderStatusText ?? '',
      actualSignAmountCent: v.actualSignedAmountCent ?? 0,
      isEffectiveSigned: isEffectiveSignedView(v),
      refundCent: v.boardRefundAmountCent ?? v.returnAmountCent ?? 0,
      dateKey,
      failReason,
      hasShopSessions,
      timeRuleHint: timeRule ? timeRule.anchor.name : '—',
      legacyKeepable,
    })
  }

  const remapped = await remapViewsWithCanonicalAttribution(core)
  const stillUnassigned = remapped.filter((v) => (v.anchorName ?? '') === '未归属')

  const signedN = unassigned.filter((r) => r.isEffectiveSigned).length
  const signedAmt = unassigned
    .filter((r) => r.isEffectiveSigned)
    .reduce((s, r) => s + r.actualSignAmountCent, 0)
  const refundN = unassigned.filter((r) => r.refundCent > 0).length
  const refundAmt = unassigned.reduce((s, r) => s + r.refundCent, 0)
  const gmv = unassigned.reduce((s, r) => s + r.paymentBaseCent, 0)

  console.log('=== Overview: unassigned (canonical) ===')
  console.log(`orders: ${unassigned.length}`)
  console.log(`GMV: ${yuan(gmv)}`)
  console.log(`signed: ${signedN} / ${yuan(signedAmt)}`)
  console.log(`refund: ${refundN} / ${yuan(refundAmt)}`)
  console.log(`range total GMV (included): ${yuan(totalGmv)}`)
  console.log(
    `original-view had keepable anchor but canonical→未归属: ${originalButOverwritten} / ${yuan(originalButOverwrittenGmv)}`,
  )
  console.log(`remap still 未归属: ${stillUnassigned.length}`)
  console.log('')

  // by date
  console.log('=== By date ===')
  const byDate = new Map<string, { n: number; gmv: number; signed: number }>()
  for (const r of unassigned) {
    const k = r.dateKey ?? 'unknown'
    const cur = byDate.get(k) ?? { n: 0, gmv: 0, signed: 0 }
    cur.n++
    cur.gmv += r.paymentBaseCent
    if (r.isEffectiveSigned) cur.signed += r.actualSignAmountCent
    byDate.set(k, cur)
  }
  for (const k of [...byDate.keys()].sort()) {
    const v = byDate.get(k)!
    console.log(`  ${k}: n=${v.n} GMV=${yuan(v.gmv)} signed=${yuan(v.signed)}`)
  }
  console.log('')

  // by shop
  console.log('=== By liveAccountName ===')
  const byShop = new Map<string, { n: number; gmv: number }>()
  for (const r of unassigned) {
    const k = r.liveAccountName || '(empty)'
    const cur = byShop.get(k) ?? { n: 0, gmv: 0 }
    cur.n++
    cur.gmv += r.paymentBaseCent
    byShop.set(k, cur)
  }
  for (const [k, v] of [...byShop.entries()].sort((a, b) => b[1].gmv - a[1].gmv)) {
    console.log(`  ${k}: n=${v.n} GMV=${yuan(v.gmv)}`)
  }
  console.log('')

  // by fail reason
  console.log('=== By failReason ===')
  const byReason = new Map<FailReason, Row[]>()
  for (const r of unassigned) {
    const list = byReason.get(r.failReason) ?? []
    list.push(r)
    byReason.set(r.failReason, list)
  }
  for (const reason of [...byReason.keys()].sort()) {
    const list = byReason.get(reason)!
    const rg = list.reduce((s, x) => s + x.paymentBaseCent, 0)
    const rs = list
      .filter((x) => x.isEffectiveSigned)
      .reduce((s, x) => s + x.actualSignAmountCent, 0)
    console.log(`  ${reason}: n=${list.length} GMV=${yuan(rg)} signed=${yuan(rs)}`)
    for (const s of list.slice(0, 3)) {
      console.log(
        `    sample ${s.orderNo} create=${s.createTime} shop=${s.liveAccountName} orig=${s.originalAnchorName} timeRule=${s.timeRuleHint} explain=${s.attributionExplain}`,
      )
    }
  }
  console.log('')

  // every unassigned order (compact)
  console.log('=== Each unassigned order ===')
  for (const r of unassigned) {
    console.log(
      JSON.stringify({
        orderNo: r.orderNo,
        packageId: r.packageId,
        createTime: r.createTime,
        payTime: r.payTime,
        liveAccountId: r.liveAccountId,
        liveAccountName: r.liveAccountName,
        originalAnchorId: r.originalAnchorId,
        originalAnchorName: r.originalAnchorName,
        canonicalAnchorId: r.canonicalAnchorId,
        canonicalAnchorName: r.canonicalAnchorName,
        canonicalAttributionType: r.canonicalAttributionType,
        attributionExplain: r.attributionExplain,
        matchedLiveSessionId: r.matchedLiveSessionId,
        matchedScheduleId: r.matchedScheduleId,
        paymentBaseCent: r.paymentBaseCent,
        orderStatusText: r.orderStatusText,
        actualSignAmountCent: r.actualSignAmountCent,
        isEffectiveSigned: r.isEffectiveSigned,
        failReason: r.failReason,
        timeRuleHint: r.timeRuleHint,
        legacyKeepable: r.legacyKeepable,
      }),
    )
  }
  console.log('')

  // Phase 6: 06-26 focus
  console.log(`=== Focus ${FOCUS_DAY} ===`)
  const day26 = unassigned.filter((r) => r.dateKey === FOCUS_DAY)
  console.log(`unassigned on ${FOCUS_DAY}: ${day26.length}`)
  const table26 = await getEffectiveScheduleTableForDate(FOCUS_DAY)
  const assign26 = await resolveDailyReportLiveSessionAssignments(FOCUS_DAY)
  console.log(
    `schedule rows=${table26.rows.length} assignedSessions=${assign26.assignedSessions.length} unassignedSessions=${assign26.unassignedSessions.length}`,
  )
  for (const r of day26) {
    console.log(
      JSON.stringify({
        orderNo: r.orderNo,
        createTime: r.createTime,
        liveAccountName: r.liveAccountName,
        originalAnchorName: r.originalAnchorName,
        explain: r.attributionExplain,
        failReason: r.failReason,
        timeRuleHint: r.timeRuleHint,
        gmv: r.paymentBaseCent,
      }),
    )
  }

  console.log('\nDONE (readonly)')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
