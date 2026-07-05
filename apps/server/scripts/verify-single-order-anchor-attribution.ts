/**
 * 单订单主播归属只读排查（按支付日历史生效排班验收，不改库）
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
import { resolveAnchorByLiveSessionPayTime } from '../src/services/anchor-live-session-order-attribution.service'
import { resolveDailyReportLiveSessionAssignments } from '../src/services/daily-report-live-sessions.service'
import { ensureManualAnchorOverrideCache } from '../src/services/order-anchor-manual-override.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { scheduleDateFromPayMs } from '../src/utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'
import { formatDateTimeShanghai } from '../src/utils/business-timezone'
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  computeExpectedAnchorFromEffectiveSchedule,
  loadDailyScheduleMeta,
  pickBuyerNick,
  pickProductName,
  pickSkuId,
} from './lib/anchor-attribution-verify.util'

config({ path: path.resolve(__dirname, '../.env') })

const ORDER_NO = (process.env.ORDER_NO ?? '').trim()

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

function findViewByOrderNo(views: AnalyzedOrderView[], orderNo: string): AnalyzedOrderView | undefined {
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
  if (!rawRow) {
    console.log('FAIL: 数据库未找到原始订单')
    process.exit(1)
  }

  const rawJson = (rawRow.rawJson ?? {}) as Record<string, unknown>
  const payText = String(rawJson.paidAt ?? '')
  const payMs =
    parseViewPayTimeMs({ orderTimeText: payText } as AnalyzedOrderView) ??
    (rawRow.orderTime ? rawRow.orderTime.getTime() : null)
  const dateKey = payMs != null ? scheduleDateFromPayMs(payMs) : ''

  section('2. packageId / orderId')
  console.log('packageId:', rawRow.packageId ?? '—')
  console.log('orderId:', rawRow.orderId ?? '—')

  section('3. 买家昵称')
  console.log(pickBuyerNick(rawJson))

  section('4. 商品名 / SKU')
  console.log('商品名:', pickProductName(rawJson))
  console.log('SKU:', pickSkuId(rawJson))

  section('5. 店铺 / liveAccountName')
  console.log(rawRow.liveAccountName ?? '—')

  section('6. 下单时间')
  console.log(String(rawJson.orderedAt ?? '—'))

  section('7. 支付时间')
  console.log(payText || (rawRow.orderTime ? formatDateTimeShanghai(rawRow.orderTime) : '—'))

  section('8. 原始订单主播字段')
  console.log(JSON.stringify(pickRawAnchorFields(rawJson), null, 2) || '{}')

  const manualRows = await prisma.orderAnchorManualOverride.findMany({
    where: { orderKey: ORDER_NO },
  })

  section('12. OrderAnchorManualOverride')
  if (manualRows.length === 0) {
    console.log('无手动指定')
  } else {
    for (const row of manualRows) {
      console.log(JSON.stringify(row, null, 2))
    }
  }

  section(`13. ${dateKey || '—'} AnchorDailySchedule (enabled=1)`)
  if (dateKey) {
    const dailyRows = await prisma.anchorDailySchedule.findMany({
      where: { scheduleDate: dateKey, enabled: true },
      orderBy: { startAt: 'asc' },
    })
    for (const row of dailyRows) {
      console.log(
        JSON.stringify({
          id: row.id,
          anchorName: row.anchorName,
          shopName: row.shopName,
          liveRoomName: row.liveRoomName,
          startAt: formatDateTimeShanghai(row.startAt),
          endAt: formatDateTimeShanghai(row.endAt),
          source: row.source,
          enabled: row.enabled,
          locked: row.locked,
          confirmed: row.confirmed,
          confirmedAt: row.confirmedAt?.toISOString() ?? null,
          note: row.note,
        }),
      )
    }
    if (dailyRows.length === 0) {
      console.log('⚠ 该日期无日排班记录')
    }
  }

  section(`14. getEffectiveScheduleTableForDate('${dateKey}')`)
  let expectedHit: Awaited<ReturnType<typeof computeExpectedAnchorFromEffectiveSchedule>>['hit'] =
    null
  if (dateKey && payMs != null && rawRow.liveAccountName) {
    const { hit, table, meta } = await computeExpectedAnchorFromEffectiveSchedule({
      dateKey,
      payMs,
      liveAccountName: String(rawRow.liveAccountName),
    })
    expectedHit = hit
    console.log('sourceSummary:', JSON.stringify(table.sourceSummary))
    console.log('confirmed:', table.confirmed)
    console.log('hasDailyScheduleRows:', meta.dbRowCount > 0)
    if (table.warnings.length) console.log('warnings:', table.warnings)
    console.log('rows:')
    for (const r of table.rows) {
      console.log(
        JSON.stringify({
          rowId: r.rowId,
          source: r.source,
          anchorName: r.anchorName,
          shopName: r.shopName,
          liveRoomName: r.liveRoomName,
          startTime: r.startTime,
          endTime: r.endTime,
          confirmed: r.confirmed,
        }),
      )
    }
    if (meta.dbRowCount === 0 && table.sourceSummary.virtualCount > 0) {
      console.log(
        '⚠ 该日期无日排班，使用模板兜底；请确认这不是历史排班缺失。',
      )
    }
  }

  section(`15-17. ${dateKey || '—'} 真实直播场次与切段`)
  if (dateKey) {
    const assignment = await resolveDailyReportLiveSessionAssignments(dateKey)
    const xyDebug = assignment.debugRows.filter(
      (r) =>
        orderLiveRoomMatchesSchedule('XY祥钰珠宝', r.sourceShopName, r.liveAccountName) ||
        r.sourceShopName.includes('XY') ||
        r.liveAccountName.includes('XY'),
    )
    for (const row of xyDebug) {
      console.log(JSON.stringify(row, null, 2))
    }
    if (payMs != null) {
      const bundle = await buildRawAnalyzeBundleAll()
      if (bundle) {
        const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
        const rawByMatch = new Map(
          (artifacts.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
        )
        const viewRaw = findViewByOrderNo(artifacts.views, ORDER_NO)
        if (viewRaw) {
          const view = attachRawByMatchToViews([viewRaw], rawByMatch)[0]
          const liveHit = await resolveAnchorByLiveSessionPayTime(view, payMs)
          if (liveHit) {
            console.log(
              'live_session 命中:',
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
          } else {
            console.log('支付时间未命中已切段真实直播窗口')
          }
        }
      }
    }
  }

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.log('FAIL: 无法加载分析包')
    process.exit(1)
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map(
    (artifacts.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )
  const viewRaw = findViewByOrderNo(artifacts.views, ORDER_NO)
  if (!viewRaw) {
    console.log('FAIL: 未解析为经营视图')
    process.exit(1)
  }
  const view = attachRawByMatchToViews([viewRaw], rawByMatch)[0] as AnalyzedOrderView & {
    raw?: Record<string, unknown>
  }

  const resolved: ScheduleAttributionResult = await resolveAnchorWithScheduleOverlay(view)

  section('9. 当前系统归属主播')
  console.log(resolved.anchorName)

  section('10. 当前归属来源')
  console.log(resolved.attributionSource)

  section('11. attributionExplain')
  console.log(resolved.attributionExplain)

  section('15. expectedAnchor（来自当天生效排班，非硬编码）')
  if (expectedHit) {
    console.log('expectedAnchorName:', expectedHit.anchorName)
    console.log('expectedScheduleSource:', expectedHit.row.source)
    console.log('expectedRowId:', expectedHit.row.rowId)
    console.log('reason:', expectedHit.reason)
    if (expectedHit.dateConfirmed) {
      console.log('⚠ 当天排班已 confirmed=true，不应自动覆盖历史排班')
    }
  } else {
    console.log('expectedAnchorName: —（未命中当天生效排班）')
  }

  section('18. 与 expectedAnchor 是否一致')
  const hasManual = manualRows.length > 0
  if (hasManual) {
    const manualAnchor = manualRows[0]!.anchorName
    const ok = resolved.anchorName === manualAnchor && resolved.attributionSource === 'manual_override'
    if (ok) {
      console.log(`✓ PASS: 有手动指定 → ${manualAnchor}（跳过排班自动校验）`)
    } else {
      console.log(`✗ FAIL: 手动指定 ${manualAnchor}，系统归属 ${resolved.anchorName} (${resolved.attributionSource})`)
      process.exit(1)
    }
    return
  }

  if (!expectedHit) {
    console.log('⚠ 无法从当天生效排班推导 expectedAnchor，跳过自动 FAIL')
    if (resolved.attributionSource === 'unmatched') {
      console.log('✓ PASS: 系统也未归属')
    } else {
      console.log(`当前归属: ${resolved.anchorName} (${resolved.attributionSource})`)
    }
    return
  }

  const ok = resolved.anchorName === expectedHit.anchorName
  if (ok) {
    console.log(
      `✓ PASS: 系统归属 ${resolved.anchorName} = 当天生效排班期望 ${expectedHit.anchorName}`,
    )
    console.log(`  来源: ${resolved.attributionSource}`)
  } else {
    console.log(
      `✗ FAIL: 系统归属 ${resolved.anchorName} (${resolved.attributionSource})，当天生效排班期望 ${expectedHit.anchorName}`,
    )
    console.log(`  说明: ${resolved.attributionExplain}`)
    console.log(`  排班: ${expectedHit.reason}`)
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
