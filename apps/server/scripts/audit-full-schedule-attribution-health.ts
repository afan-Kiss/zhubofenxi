/**
 * 全量排班审计 + 2026-07-07 归属前后差异 + 品退一致性（只读，不改库）
 *
 * 用法（生产机）:
 *   cd /www/wwwroot/zhubo-analysis
 *   DATABASE_URL=file:./apps/server/data/app.db npx tsx apps/server/scripts/audit-full-schedule-attribution-health.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { NEW_SCHEDULE_TEMPLATE_SEEDS_20260701 } from '../src/services/anchor-schedule-template.service'
import {
  buildScheduleBounds,
  detectScheduleConflicts,
  scheduleDateFromPayMs,
} from '../src/utils/anchor-schedule-time.util'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import {
  ensureManualAnchorOverrideCache,
  resolveManualAnchorOverrideForView,
} from '../src/services/order-anchor-manual-override.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { resolveAnchorWithScheduleOverlay } from '../src/services/anchor-schedule-attribution.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildAnchorQualityRefundDrill } from '../src/services/board-drill.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'
import { isPayTimeInSchedule } from '../src/utils/anchor-schedule-time.util'
import type { AnalyzedOrderView } from '../src/types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

const START = '2026-07-01'
const TARGET_RECALC = '2026-07-07'
const END = formatDateKeyShanghai(new Date())

type Classification = 'clear_swap' | 'justified_temp' | 'needs_human'

interface AnomalyRow {
  date: string
  scheduleId: string
  shopName: string
  timeRange: string
  currentAnchor: string
  templateAnchor: string
  anomalyType: string
  classification: Classification
  suggestedAnchor: string
  note: string
  affectedOrderCount: number
  affectedPayAmountYuan: number
}

function hm(ms: number, dateKey: string, role: 'start' | 'end'): string {
  const d = new Date(ms)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const hmText = `${h}:${m}`
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  if (role === 'end' && hmText === '00:00' && day > dateKey) return '24:00'
  return hmText
}

function isTemplateLikeNote(note: string): boolean {
  const n = note.trim()
  if (!n) return true
  if (/^(早|午|晚)场/.test(n)) return true
  if (/历史修改原因/.test(n)) return false
  if (/临时|调班|替换|互换|代班|原因[:：]/.test(n)) return false
  return true
}

function templatesForDate(dateKey: string) {
  return NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.filter((t) => {
    if (t.effectiveFrom && dateKey < t.effectiveFrom) return false
    if (t.effectiveTo && dateKey > t.effectiveTo) return false
    return true
  })
}

function detectSwap(
  day: Array<{ shopName: string; startTime: string; endTime: string; anchorName: string }>,
  templates: typeof NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
): boolean {
  const cur = new Map(day.map((r) => [`${r.shopName}|${r.startTime}`, r.anchorName]))
  const tpl = new Map(templates.map((t) => [`${t.shopName}|${t.startTime}`, t.anchorName]))
  const keys = [...tpl.keys()]
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ka = keys[i]!
      const kb = keys[j]!
      const ta = tpl.get(ka)!
      const tb = tpl.get(kb)!
      const ca = cur.get(ka)
      const cb = cur.get(kb)
      if (ca && cb && ca === tb && cb === ta && ca !== ta) return true
    }
  }
  return false
}

function resolveByScheduleRows(
  view: AnalyzedOrderView,
  rows: Array<{
    shopName: string
    liveRoomName: string
    anchorName: string
    startAt: Date
    endAt: Date
  }>,
): string {
  const payMs = parseViewPayTimeMs(view)
  const shop = (view.liveAccountName ?? '').trim()
  if (payMs == null || !shop) return '未归属'
  for (const row of rows) {
    if (!orderLiveRoomMatchesSchedule(shop, row.shopName, row.liveRoomName)) continue
    if (!isPayTimeInSchedule(payMs, row.startAt, row.endAt)) continue
    return row.anchorName
  }
  return '未归属'
}

async function auditSchedules(views: AnalyzedOrderView[]): Promise<{
  anomalies: AnomalyRow[]
  scanDateCount: number
  clearSwap: number
  justified: number
  needsHuman: number
}> {
  const startMs = Date.parse(`${START}T00:00:00+08:00`)
  const endMs = Date.parse(`${END}T23:59:59.999+08:00`)
  const rows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: { gte: START, lte: END }, enabled: true },
    orderBy: [{ scheduleDate: 'asc' }, { startAt: 'asc' }],
  })

  const byDate = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!byDate.has(r.scheduleDate)) byDate.set(r.scheduleDate, [])
    byDate.get(r.scheduleDate)!.push(r)
  }

  const allDates: string[] = []
  for (let t = startMs; t <= endMs; t += 86400000) {
    allDates.push(new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }))
  }
  // fix date iteration using string walk
  allDates.length = 0
  let cursor = START
  while (cursor <= END) {
    allDates.push(cursor)
    const d = new Date(`${cursor}T12:00:00+08:00`)
    d.setDate(d.getDate() + 1)
    cursor = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  }

  const anomalies: AnomalyRow[] = []

  for (const dateKey of allDates) {
    const day = byDate.get(dateKey) ?? []
    const templates = templatesForDate(dateKey)
    const mapped = day.map((r) => ({
      ...r,
      startTime: hm(r.startAt.getTime(), dateKey, 'start'),
      endTime: hm(r.endAt.getTime(), dateKey, 'end'),
    }))
    const conflicts = detectScheduleConflicts(
      mapped.map((r) => ({
        anchorName: r.anchorName,
        shopName: r.shopName,
        liveRoomName: r.liveRoomName,
        startAt: r.startAt,
        endAt: r.endAt,
      })),
    )
    const isSwap = detectSwap(mapped, templates)

    for (const c of conflicts) {
      for (const r of mapped) {
        anomalies.push({
          date: dateKey,
          scheduleId: r.id,
          shopName: r.shopName,
          timeRange: `${r.startTime}-${r.endTime}`,
          currentAnchor: r.anchorName,
          templateAnchor: '',
          anomalyType: c.type === 'shop_overlap' ? '同直播号时段多主播' : '同主播同时段跨直播号',
          classification: 'needs_human',
          suggestedAnchor: '',
          note: c.message,
          affectedOrderCount: 0,
          affectedPayAmountYuan: 0,
        })
      }
    }

    for (const r of mapped) {
      const tpl = templates.find((t) => t.shopName === r.shopName && t.startTime === r.startTime)
      const tplAnchor = tpl?.anchorName ?? ''
      const knownShops = new Set(templates.map((t) => t.shopName))
      if (!knownShops.has(r.shopName)) {
        anomalies.push({
          date: dateKey,
          scheduleId: r.id,
          shopName: r.shopName,
          timeRange: `${r.startTime}-${r.endTime}`,
          currentAnchor: r.anchorName,
          templateAnchor: '',
          anomalyType: '主播安排到未配置直播号',
          classification: 'needs_human',
          suggestedAnchor: '',
          note: r.note ?? '',
          affectedOrderCount: 0,
          affectedPayAmountYuan: 0,
        })
      }
      if (tplAnchor && r.anchorName !== tplAnchor) {
        const note = `${r.note ?? ''} ${r.confirmNote ?? ''}`.trim()
        const hasRealReason = !isTemplateLikeNote(note) && note.length > 0
        let classification: Classification = 'needs_human'
        let anomalyType = '偏离模板无充分说明'
        if (isSwap) {
          classification = 'clear_swap'
          anomalyType = '疑似直播号主播互换'
        } else if (hasRealReason) {
          classification = 'justified_temp'
          anomalyType = '偏离模板但有说明'
        }
        anomalies.push({
          date: dateKey,
          scheduleId: r.id,
          shopName: r.shopName,
          timeRange: `${r.startTime}-${r.endTime}`,
          currentAnchor: r.anchorName,
          templateAnchor: tplAnchor,
          anomalyType,
          classification,
          suggestedAnchor: tplAnchor,
          note,
          affectedOrderCount: 0,
          affectedPayAmountYuan: 0,
        })
      }
    }

    if (day.length && day.every((r) => r.confirmed) && (conflicts.length > 0 || isSwap)) {
      for (const r of mapped) {
        anomalies.push({
          date: dateKey,
          scheduleId: r.id,
          shopName: r.shopName,
          timeRange: `${r.startTime}-${r.endTime}`,
          currentAnchor: r.anchorName,
          templateAnchor: '',
          anomalyType: '已确认排班存在冲突',
          classification: isSwap ? 'clear_swap' : 'needs_human',
          suggestedAnchor: '',
          note: isSwap ? '疑似互换' : conflicts.map((c) => c.message).join('；'),
          affectedOrderCount: 0,
          affectedPayAmountYuan: 0,
        })
      }
    }
  }

  // attach order impact for anomaly slots
  const dayStart = Date.parse(`${START}T00:00:00+08:00`)
  const dayEnd = Date.parse(`${END}T23:59:59.999+08:00`)
  const inRange = views.filter((v) => {
    const payMs = parseViewPayTimeMs(v)
    return payMs != null && payMs >= dayStart && payMs <= dayEnd
  })

  for (const a of anomalies) {
    if (!a.templateAnchor && a.anomalyType !== '疑似直播号主播互换') continue
    const { startAt, endAt } = buildScheduleBounds(
      a.date,
      a.timeRange.split('-')[0]!,
      a.timeRange.split('-')[1]!,
    )
    let count = 0
    let amount = 0
    for (const v of inRange) {
      const payMs = parseViewPayTimeMs(v)
      if (payMs == null) continue
      if (scheduleDateFromPayMs(payMs) !== a.date) continue
      const shop = (v.liveAccountName ?? '').trim()
      if (!orderLiveRoomMatchesSchedule(shop, a.shopName, a.shopName)) continue
      if (!isPayTimeInSchedule(payMs, startAt, endAt)) continue
      count += 1
      amount += Number(v.actualPaidCent ?? v.gmvCent ?? 0) / 100
    }
    a.affectedOrderCount = count
    a.affectedPayAmountYuan = Math.round(amount * 100) / 100
  }

  // dedupe
  const seen = new Set<string>()
  const uniq = anomalies.filter((a) => {
    const k = `${a.date}|${a.scheduleId}|${a.anomalyType}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return {
    anomalies: uniq,
    scanDateCount: allDates.length,
    clearSwap: uniq.filter((a) => a.classification === 'clear_swap').length,
    justified: uniq.filter((a) => a.classification === 'justified_temp').length,
    needsHuman: uniq.filter((a) => a.classification === 'needs_human').length,
  }
}

async function recalc0707(views: AnalyzedOrderView[]) {
  const startMs = Date.parse(`${TARGET_RECALC}T00:00:00+08:00`)
  const endMs = Date.parse(`${TARGET_RECALC}T23:59:59.999+08:00`)
  const dayViews = views.filter((v) => {
    const payMs = parseViewPayTimeMs(v)
    return payMs != null && payMs >= startMs && payMs <= endMs
  })

  const dbRows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: TARGET_RECALC, enabled: true },
    orderBy: { startAt: 'asc' },
  })

  // before: recreate known wrong swap (小红↔小白 on 和田雅玉 morning / XY afternoon)
  const beforeRows = dbRows.map((r) => {
    const startTime = hm(r.startAt.getTime(), TARGET_RECALC, 'start')
    let anchorName = r.anchorName
    if (r.shopName.includes('和田雅玉') && startTime === '09:30') anchorName = '小白'
    if (r.shopName.includes('XY') && startTime === '14:00') anchorName = '小红'
    return {
      shopName: r.shopName,
      liveRoomName: r.liveRoomName,
      anchorName,
      startAt: r.startAt,
      endAt: r.endAt,
    }
  })

  const orderDiffs: Array<Record<string, unknown>> = []
  const beforeAgg = new Map<string, ReturnType<typeof emptyAgg>>()
  const afterAgg = new Map<string, ReturnType<typeof emptyAgg>>()

  function emptyAgg() {
    return {
      payAmount: 0,
      payCount: 0,
      signedAmount: 0,
      refundCount: 0,
      qualityCount: 0,
    }
  }
  function bump(map: Map<string, ReturnType<typeof emptyAgg>>, name: string, v: AnalyzedOrderView) {
    if (!map.has(name)) map.set(name, emptyAgg())
    const a = map.get(name)!
    const payYuan = Number(v.actualPaidCent ?? v.gmvCent ?? 0) / 100
    a.payAmount += payYuan
    a.payCount += 1
    if (v.isActualSigned || v.isSigned) a.signedAmount += Number(v.actualSignedAmountCent ?? 0) / 100
    if (Number(v.realAfterSaleAmountCent ?? v.returnAmountCent ?? 0) > 0) a.refundCount += 1
    if (v.isQualityReturn) a.qualityCount += 1
  }

  for (const view of dayViews) {
    const manual = resolveManualAnchorOverrideForView(view)
    const afterResolved = await resolveAnchorWithScheduleOverlay(view)
    const afterAnchor = manual?.anchorName ?? afterResolved.anchorName
    const beforeAnchor = manual?.anchorName ?? resolveByScheduleRows(view, beforeRows)
    const orderNo = resolveMetricOrderNo(view) || view.packageId || view.orderId || ''
    const payMs = parseViewPayTimeMs(view)!
    bump(beforeAgg, beforeAnchor, view)
    bump(afterAgg, afterAnchor, view)
    if (beforeAnchor !== afterAnchor) {
      orderDiffs.push({
        orderNo,
        liveAccountName: view.liveAccountName,
        payTime: view.orderTimeText ?? new Date(payMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        beforeAnchor,
        afterAnchor,
        attributionSource: manual ? 'manual_override' : afterResolved.attributionSource,
        payAmountYuan: Number(view.actualPaidCent ?? view.gmvCent ?? 0) / 100,
        refundAmountYuan: Number(view.realAfterSaleAmountCent ?? view.returnAmountCent ?? 0) / 100,
        isQualityReturn: Boolean(view.isQualityReturn),
      })
    }
  }

  const anchors = new Set([...beforeAgg.keys(), ...afterAgg.keys()])
  const summary = [...anchors].sort().map((name) => {
    const b = beforeAgg.get(name) ?? emptyAgg()
    const a = afterAgg.get(name) ?? emptyAgg()
    return {
      anchorName: name,
      beforePayAmount: Math.round(b.payAmount * 100) / 100,
      afterPayAmount: Math.round(a.payAmount * 100) / 100,
      payAmountDelta: Math.round((a.payAmount - b.payAmount) * 100) / 100,
      beforePayCount: b.payCount,
      afterPayCount: a.payCount,
      beforeSignedAmount: Math.round(b.signedAmount * 100) / 100,
      afterSignedAmount: Math.round(a.signedAmount * 100) / 100,
      beforeRefundCount: b.refundCount,
      afterRefundCount: a.refundCount,
      beforeQualityCount: b.qualityCount,
      afterQualityCount: a.qualityCount,
    }
  })

  const beforeTotal = [...beforeAgg.values()].reduce((s, x) => s + x.payCount, 0)
  const afterTotal = [...afterAgg.values()].reduce((s, x) => s + x.payCount, 0)
  const beforePay = [...beforeAgg.values()].reduce((s, x) => s + x.payAmount, 0)
  const afterPay = [...afterAgg.values()].reduce((s, x) => s + x.payAmount, 0)

  return {
    orderCount: dayViews.length,
    changedOrderCount: orderDiffs.length,
    orderDiffs,
    summary,
    totalsConsistent:
      beforeTotal === afterTotal &&
      beforeTotal === dayViews.length &&
      Math.abs(beforePay - afterPay) < 0.01,
    beforeTotalOrders: beforeTotal,
    afterTotalOrders: afterTotal,
    dayViewsCount: dayViews.length,
  }
}

async function qualityConsistency() {
  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: START,
    endDate: END,
  })
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: START,
    endDate: END,
    role: 'super_admin',
    username: 'audit-script',
  })
  const leaderboard = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>
  const results: Array<Record<string, unknown>> = []
  const packageOwners = new Map<string, string>()
  let packageDup = 0
  let mismatch = 0

  for (const row of leaderboard) {
    const anchorName = String(row.anchorName ?? '')
    if (!anchorName) continue
    const cardCount = Number(row.qualityReturnCount ?? 0)
    const drawer = await buildAnchorQualityRefundDrill({
      preset: 'custom',
      startDate: START,
      endDate: END,
      anchorName,
      page: 1,
      pageSize: 500,
      role: 'super_admin',
      username: 'audit-script',
    })
    const paginationTotal = drawer.pagination?.total ?? 0
    const rows = drawer.rows ?? []
    const keys = rows.map((r) => {
      const rec = r as Record<string, unknown>
      return String(rec.orderNo || rec.packageId || rec.orderId || '')
    })
    const dedup = new Set(keys.filter(Boolean))
    for (const k of dedup) {
      const prev = packageOwners.get(k)
      if (prev && prev !== anchorName) packageDup += 1
      else packageOwners.set(k, anchorName)
    }
    const ok =
      cardCount === paginationTotal && paginationTotal === dedup.size
    if (!ok) mismatch += 1
    results.push({
      anchorName,
      cardCount,
      paginationTotal,
      dedupRowCount: dedup.size,
      ok,
      focus: ['子杰', '小红', '小白'].includes(anchorName),
    })
  }

  return { results, mismatchCount: mismatch, packageCrossAnchorDup: packageDup }
}

async function main() {
  console.log('bootstrap…')
  await bootstrapQualityBadCaseCache()
  await ensureManualAnchorOverrideCache()
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) throw new Error('无分析数据')
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map(
    (artifacts.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )
  const views = attachRawByMatchToViews(artifacts.views, rawByMatch)

  console.log('audit schedules…')
  const scheduleAudit = await auditSchedules(views)
  console.log('recalc 0707…')
  const recalc = await recalc0707(views)
  console.log('quality consistency…')
  const quality = await qualityConsistency()

  const report = {
    generatedAt: new Date().toISOString(),
    range: { start: START, end: END },
    scheduleAudit: {
      scanDateCount: scheduleAudit.scanDateCount,
      anomalyCount: scheduleAudit.anomalies.length,
      clearSwapCount: scheduleAudit.clearSwap,
      justifiedTempCount: scheduleAudit.justified,
      needsHumanCount: scheduleAudit.needsHuman,
      autoConfirmFixCount: 0,
      affectedOrderTotal: scheduleAudit.anomalies.reduce((s, a) => s + a.affectedOrderCount, 0),
      affectedPayAmountTotal: Math.round(
        scheduleAudit.anomalies.reduce((s, a) => s + a.affectedPayAmountYuan, 0) * 100,
      ) / 100,
      anomalies: scheduleAudit.anomalies,
    },
    recalc0707: recalc,
    qualityConsistency: quality,
  }

  const candidates = [
    path.resolve(__dirname, '../../../deploy/aliyun/_full-attribution-health-report.json'),
    path.resolve(process.cwd(), '../../deploy/aliyun/_full-attribution-health-report.json'),
    path.resolve(process.cwd(), 'deploy/aliyun/_full-attribution-health-report.json'),
    '/tmp/_full-attribution-health-report.json',
  ]
  let target = candidates[0]!
  for (const c of candidates) {
    try {
      fs.mkdirSync(path.dirname(c), { recursive: true })
      target = c
      break
    } catch {
      /* try next */
    }
  }
  fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8')
  console.log('WROTE', target)
  console.log(
    JSON.stringify(
      {
        scanDateCount: report.scheduleAudit.scanDateCount,
        anomalyCount: report.scheduleAudit.anomalyCount,
        clearSwap: report.scheduleAudit.clearSwapCount,
        needsHuman: report.scheduleAudit.needsHumanCount,
        justified: report.scheduleAudit.justifiedTempCount,
        affectedOrders: report.scheduleAudit.affectedOrderTotal,
        affectedAmount: report.scheduleAudit.affectedPayAmountTotal,
        recalcChanged: report.recalc0707.changedOrderCount,
        totalsConsistent: report.recalc0707.totalsConsistent,
        qualityMismatch: report.qualityConsistency.mismatchCount,
        packageDup: report.qualityConsistency.packageCrossAnchorDup,
        focusQuality: report.qualityConsistency.results.filter((r) => r.focus),
        recalcSummary: report.recalc0707.summary,
      },
      null,
      2,
    ),
  )
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
