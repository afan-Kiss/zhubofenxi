/**
 * 单订单主播归属只读排查
 *
 * ORDER_NO=P798535644148309221 npm run verify:single-order-anchor-attribution
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import {
  resolveAnchorWithScheduleOverlay,
  type ScheduleAttributionResult,
} from '../src/services/anchor-schedule-attribution.service'
import {
  resolveAnchorByLiveSessionPayTime,
} from '../src/services/anchor-live-session-order-attribution.service'
import { resolveDailyReportLiveSessionAssignments } from '../src/services/daily-report-live-sessions.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { ensureManualAnchorOverrideCache } from '../src/services/order-anchor-manual-override.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { scheduleDateFromPayMs, isPayTimeInSchedule } from '../src/utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'
import { formatDateTimeShanghai } from '../src/utils/business-timezone'
import type { AnalyzedOrderView } from '../src/types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

const ORDER_NO = (process.env.ORDER_NO ?? '').trim()
const EXPECTED_ANCHOR = (process.env.EXPECTED_ANCHOR ?? '小白').trim()

if (!ORDER_NO) {
  console.error('FAIL: 请设置 ORDER_NO，例如 ORDER_NO=P798535644148309221')
  process.exit(1)
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function pickRawAnchorFields(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {}
  const out: Record<string, unknown> = {}
  for (const key of [
    'anchorName',
    'anchor_name',
    'liveAnchorName',
    'live_anchor_name',
    'hostName',
    'host_name',
    'sellerName',
  ]) {
    if (raw[key] != null && String(raw[key]).trim()) out[key] = raw[key]
  }
  return out
}

function findViewByOrderNo(
  views: AnalyzedOrderView[],
  orderNo: string,
): AnalyzedOrderView | undefined {
  const bare = orderNo.replace(/^P/, '')
  return views.find(
    (v) =>
      v.orderId === orderNo ||
      v.packageId === orderNo ||
      v.matchOrderId === orderNo ||
      v.orderId === bare ||
      v.packageId === bare ||
      v.matchOrderId === bare,
  )
}

async function computeExpectedAnchor(params: {
  payMs: number
  liveAccountName: string
  dateKey: string
}): Promise<{ anchorName: string | null; rowId?: string; reason: string }> {
  const table = await getEffectiveScheduleTableForDate(params.dateKey)
  for (const row of table.rows) {
    if (!row.enabled) continue
    if (!orderLiveRoomMatchesSchedule(params.liveAccountName, row.shopName, row.liveRoomName)) {
      continue
    }
    const startAt = new Date(row.startAt)
    const endAt = new Date(row.endAt)
    if (isPayTimeInSchedule(params.payMs, startAt, endAt)) {
      return {
        anchorName: row.anchorName,
        rowId: row.rowId,
        reason: `排班 ${row.liveRoomName} ${row.startTime}-${row.endTime}`,
      }
    }
  }
  return { anchorName: null, reason: '未命中生效排班' }
}

async function main(): Promise<void> {
  await bootstrapQualityBadCaseCache()
  await ensureManualAnchorOverrideCache()

  section('1. 订单号')
  console.log(ORDER_NO)

  const rawRows = await prisma.xhsRawOrder.findMany({
    where: {
      OR: [{ orderId: ORDER_NO }, { packageId: ORDER_NO }, { orderId: ORDER_NO.replace(/^P/, '') }],
    },
    take: 3,
  })
  const rawRow = rawRows[0] ?? null

  section('2-6. 原始订单字段')
  if (!rawRow) {
    console.log('FAIL: 数据库未找到原始订单')
    process.exit(1)
  }
  const rawJson = (rawRow.rawJson ?? {}) as Record<string, unknown>
  console.log('packageId:', rawRow.packageId ?? '—')
  console.log('orderId:', rawRow.orderId ?? '—')
  console.log(
    'matchOrderId:',
    rawRow.packageId?.trim() || rawRow.orderId?.trim() || ORDER_NO,
  )
  console.log(
    '支付时间 paidAt:',
    rawJson.paidAt ?? (rawRow.orderTime ? formatDateTimeShanghai(rawRow.orderTime) : '—'),
  )
  console.log('下单时间 orderedAt:', rawJson.orderedAt ?? '—')
  console.log('liveAccountName:', rawRow.liveAccountName ?? '—')
  console.log('shopName(liveAccountName):', rawRow.liveAccountName ?? '—')
  console.log('原始主播字段:', JSON.stringify(pickRawAnchorFields(rawJson), null, 2))

  section('7. OrderAnchorManualOverride')
  const manualRows = await prisma.orderAnchorManualOverride.findMany({
    where: { orderKey: ORDER_NO },
  })
  if (manualRows.length === 0) {
    console.log('无手动指定')
  } else {
    for (const row of manualRows) {
      console.log(JSON.stringify(row, null, 2))
    }
  }

  const payText = String(rawJson.paidAt ?? '')
  const payMs =
    parseViewPayTimeMs({ orderTimeText: payText } as AnalyzedOrderView) ??
    (rawRow.orderTime ? rawRow.orderTime.getTime() : null)
  const dateKey = payMs != null ? scheduleDateFromPayMs(payMs) : ''

  section(`8. ${dateKey || '—'} 生效排班 AnchorDailySchedule (enabled=1)`)
  if (dateKey) {
    const dailyRows = await prisma.anchorDailySchedule.findMany({
      where: { scheduleDate: dateKey, enabled: true },
      orderBy: { startAt: 'asc' },
    })
    for (const row of dailyRows) {
      console.log(
        [
          row.id,
          row.anchorName,
          row.shopName,
          row.liveRoomName,
          formatDateTimeShanghai(row.startAt),
          formatDateTimeShanghai(row.endAt),
          row.source,
          row.note ?? '',
        ].join(' | '),
      )
    }
    const effective = await getEffectiveScheduleTableForDate(dateKey)
    console.log(`\n合并生效排班 ${effective.rows.length} 行 (confirmed=${effective.confirmed})`)
  }

  section(`9. ${dateKey || '—'} XY祥钰珠宝 真实直播场次`)
  let xySessions: Awaited<ReturnType<typeof resolveDailyReportLiveSessionAssignments>> | null =
    null
  if (dateKey) {
    xySessions = await resolveDailyReportLiveSessionAssignments(dateKey)
    const xyAssigned = xySessions.assignedSessions.filter(
      (s) =>
        s.sourceShopName.includes('XY') ||
        s.liveAccountName.includes('XY') ||
        orderLiveRoomMatchesSchedule('XY祥钰珠宝', s.sourceShopName, s.liveAccountName),
    )
    if (xyAssigned.length === 0) {
      console.log('无已归属 XY 场次；全部 XY 原始场次:')
      const allXy = xySessions.allSessions.filter(
        (s) =>
          s.sourceShopName.includes('XY') ||
          s.liveAccountName.includes('XY') ||
          orderLiveRoomMatchesSchedule('XY祥钰珠宝', s.sourceShopName, s.liveAccountName),
      )
      for (const s of allXy) {
        console.log(JSON.stringify({ liveId: s.liveId, start: s.startTime, end: s.endTime }, null, 2))
      }
    } else {
      for (const s of xyAssigned) {
        const anchor =
          [...xySessions.byAnchor.entries()].find(([, list]) => list.some((x) => x.liveId === s.liveId))
            ?.[0] ?? '—'
        console.log(
          JSON.stringify(
            {
              anchorName: anchor,
              liveId: s.liveId,
              startTime: s.startTime,
              endTime: s.endTime,
              sourceShopName: s.sourceShopName,
            },
            null,
            2,
          ),
        )
      }
    }
  }

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.log('\nFAIL: 无法加载分析包')
    process.exit(1)
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const viewRaw = findViewByOrderNo(artifacts.views, ORDER_NO)
  if (!viewRaw) {
    console.log('\nFAIL: 未解析为经营视图')
    process.exit(1)
  }
  const view = attachRawByMatchToViews([viewRaw], artifacts.rawByMatch)[0] as AnalyzedOrderView & {
    raw?: Record<string, unknown>
  }

  section('10. resolveAnchorWithScheduleOverlay 最终结果')
  const resolved: ScheduleAttributionResult = await resolveAnchorWithScheduleOverlay(view)
  console.log(JSON.stringify(resolved, null, 2))

  section('11. live_session 命中详情')
  if (resolved.attributionSource === 'live_session' && payMs != null) {
    const liveHit = await resolveAnchorByLiveSessionPayTime(view, payMs)
    if (liveHit) {
      console.log(
        JSON.stringify(
          {
            liveId: liveHit.liveId,
            liveStart: formatDateTimeShanghai(new Date(liveHit.liveStartMs)),
            liveEnd: formatDateTimeShanghai(new Date(liveHit.liveEndMs)),
            anchorName: liveHit.anchorName,
            explain: liveHit.explain,
          },
          null,
          2,
        ),
      )
    }
  } else {
    console.log('attributionSource 非 live_session，跳过')
  }

  section('12. manual_override 详情')
  if (resolved.attributionSource === 'manual_override') {
    console.log(JSON.stringify(manualRows, null, 2))
  } else {
    console.log('非 manual_override')
  }

  section('13. 按排班期望主播')
  const expected =
    payMs != null && view.liveAccountName
      ? await computeExpectedAnchor({
          payMs,
          liveAccountName: String(view.liveAccountName),
          dateKey,
        })
      : { anchorName: null, reason: '缺少支付时间或直播号' }
  console.log('expectedAnchorName:', expected.anchorName ?? '—')
  console.log('reason:', expected.reason)
  if (expected.rowId) console.log('matchedScheduleRowId:', expected.rowId)

  section('验收')
  const expectName = manualRows.length > 0 ? manualRows[0]!.anchorName : EXPECTED_ANCHOR
  const pass = resolved.anchorName === expectName
  if (pass) {
    console.log(`✓ PASS: 最终归属 ${resolved.anchorName}，期望 ${expectName}`)
    console.log(`  来源: ${resolved.attributionSource}`)
    console.log(`  说明: ${resolved.attributionExplain}`)
  } else {
    console.log(`✗ FAIL: 最终归属 ${resolved.anchorName}，期望 ${expectName}`)
    console.log(`  来源: ${resolved.attributionSource}`)
    console.log(`  说明: ${resolved.attributionExplain}`)
    if (manualRows.length === 0 && expected.anchorName && expected.anchorName !== resolved.anchorName) {
      console.log(`  排班重算期望: ${expected.anchorName} (${expected.reason})`)
    }
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error('FAIL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
