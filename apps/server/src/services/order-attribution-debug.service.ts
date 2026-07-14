import { prisma } from '../lib/prisma'
import { getAnchorConfigSync } from './anchor.service'
import {
  parseViewPayTimeMs,
  resolveAnchorForPerformanceAttribution,
  SHOP_SESSION_ANCHOR_CUTOFF_MS,
} from './anchor-performance-attribution.service'
import {
  resolveAnchorWithScheduleOverlay,
  type ScheduleAttributionSource,
} from './anchor-schedule-attribution.service'
import { ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE } from '../config/anchor-schedule.constants'
import { buildRawAnalyzeBundleAll } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { scheduleDateFromPayMs } from '../utils/anchor-schedule-time.util'
import {
  getEffectiveScheduleTableForDate,
  type EffectiveScheduleRow,
} from './anchor-daily-schedule.service'
import type { AnalyzedOrderView } from '../types/analysis'

export interface OrderAttributionDebugResult {
  ok: boolean
  orderNo: string
  payTime: string
  liveAccountName: string
  finalAnchorName: string
  attributionSource: string
  attributionExplain: string
  matchedScheduleRow?: EffectiveScheduleRow
  effectiveScheduleTable?: Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>
  checkedRules: Array<{ ruleName: string; matched: boolean; reason: string }>
}

async function findRawOrder(orderNo: string) {
  const rows = await prisma.xhsRawOrder.findMany({
    where: {
      OR: [{ orderId: orderNo }, { packageId: orderNo }],
    },
    orderBy: { orderTime: 'desc' },
    take: 5,
  })
  if (rows.length > 0) return rows[0]
  const fuzzy = await prisma.xhsRawOrder.findMany({
    where: {
      OR: [{ orderId: { contains: orderNo } }, { packageId: { contains: orderNo } }],
    },
    orderBy: { orderTime: 'desc' },
    take: 1,
  })
  return fuzzy[0] ?? null
}

function mapAttributionSource(source: ScheduleAttributionSource): string {
  if (source === 'live_session') return 'live_session'
  if (source === 'manual_schedule' || source === 'default_schedule' || source === 'template_virtual') {
    return 'effective_schedule'
  }
  if (source === 'manual_override') return 'manual_override'
  const map: Record<ScheduleAttributionSource, string> = {
    live_session: 'live_session',
    manual_schedule: 'effective_schedule',
    default_schedule: 'effective_schedule',
    template_virtual: 'effective_schedule',
    legacy_rule: 'legacy_rule',
    manual_override: 'manual_override',
    offline_manual: 'offline_manual',
    unassigned: 'unassigned',
    unmatched: 'unmatched',
    confirmed_schedule: 'confirmed_schedule',
    conflict: 'conflict',
  }
  return map[source] ?? source
}

function findMatchedRow(
  table: Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>,
  rowId?: string,
): EffectiveScheduleRow | undefined {
  if (!rowId) return undefined
  return table.rows.find((r) => r.rowId === rowId)
}

export async function buildOrderAttributionDebug(orderNo: string): Promise<OrderAttributionDebugResult> {
  const checkedRules: OrderAttributionDebugResult['checkedRules'] = []
  const rawRow = await findRawOrder(orderNo)
  if (!rawRow) {
    return {
      ok: false,
      orderNo,
      payTime: '',
      liveAccountName: '',
      finalAnchorName: '',
      attributionSource: 'unmatched',
      attributionExplain: `数据库中未找到订单 ${orderNo}`,
      checkedRules: [{ ruleName: 'raw_order_lookup', matched: false, reason: '无原始订单记录' }],
    }
  }

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    return {
      ok: false,
      orderNo,
      payTime: rawRow.orderTime?.toISOString() ?? '',
      liveAccountName: rawRow.liveAccountName ?? '',
      finalAnchorName: '',
      attributionSource: 'unmatched',
      attributionExplain: '本地尚无可用订单分析数据',
      checkedRules: [{ ruleName: 'analyze_bundle', matched: false, reason: '分析包为空' }],
    }
  }

  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const view = artifacts.views.find(
    (v: AnalyzedOrderView) =>
      v.orderId === orderNo || v.matchOrderId === orderNo || v.packageId === orderNo,
  ) as (AnalyzedOrderView & { raw?: Record<string, unknown> }) | undefined

  if (!view) {
    return {
      ok: false,
      orderNo,
      payTime: rawRow.orderTime?.toISOString() ?? '',
      liveAccountName: rawRow.liveAccountName ?? '',
      finalAnchorName: '',
      attributionSource: 'unmatched',
      attributionExplain: '找到原始订单但未能解析为经营视图',
      checkedRules: [{ ruleName: 'analyze_view', matched: false, reason: '解析失败' }],
    }
  }

  const payMs = parseViewPayTimeMs(view)
  const payTime =
    payMs != null
      ? new Date(payMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
      : view.orderTimeText ?? ''
  const liveAccountName = (view.liveAccountName ?? rawRow.liveAccountName ?? '').trim()
  const dateKey = payMs != null ? scheduleDateFromPayMs(payMs) : ''
  const before613 = payMs != null && payMs < SHOP_SESSION_ANCHOR_CUTOFF_MS
  checkedRules.push({
    ruleName: 'date_cutoff',
    matched: !before613,
    reason: before613
      ? `支付时间早于 ${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE}，走旧规则`
      : `${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE} 起按生效排班表归属`,
  })

  let effectiveScheduleTable: Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>> | undefined
  if (dateKey) {
    effectiveScheduleTable = await getEffectiveScheduleTableForDate(dateKey)
    checkedRules.push({
      ruleName: 'effective_schedule_table',
      matched: effectiveScheduleTable.rows.length > 0,
      reason: `生效排班 ${effectiveScheduleTable.rows.length} 条（人工 ${effectiveScheduleTable.sourceSummary.manualCount} / 默认 ${effectiveScheduleTable.sourceSummary.generatedCount} / 模板补齐 ${effectiveScheduleTable.sourceSummary.virtualCount}）`,
    })
  }

  const config = getAnchorConfigSync()
  const legacy = resolveAnchorForPerformanceAttribution(view, config)
  checkedRules.push({
    ruleName: 'legacy_rule',
    matched: legacy.anchorName !== '未归属',
    reason:
      legacy.anchorName !== '未归属'
        ? `旧规则/直播号场次 → ${legacy.anchorName}`
        : before613
          ? '旧规则未归属'
          : '6.13 后不使用旧规则兜底',
  })

  const resolved = await resolveAnchorWithScheduleOverlay(view)
  const matchedScheduleRow =
    effectiveScheduleTable && resolved.matchedScheduleRowId
      ? findMatchedRow(effectiveScheduleTable, resolved.matchedScheduleRowId)
      : undefined

  if (matchedScheduleRow) {
    checkedRules.push({
      ruleName: 'schedule_match',
      matched: true,
      reason: `命中生效排班 ${matchedScheduleRow.shopName} ${matchedScheduleRow.startTime}-${matchedScheduleRow.endTime} → ${matchedScheduleRow.anchorName}`,
    })
  } else if (!before613) {
    checkedRules.push({
      ruleName: 'schedule_match',
      matched: false,
      reason: '未命中当天生效排班时段',
    })
  }

  return {
    ok: true,
    orderNo,
    payTime,
    liveAccountName,
    finalAnchorName: resolved.anchorName,
    attributionSource: mapAttributionSource(resolved.attributionSource),
    attributionExplain: resolved.attributionExplain,
    matchedScheduleRow,
    effectiveScheduleTable,
    checkedRules,
  }
}
