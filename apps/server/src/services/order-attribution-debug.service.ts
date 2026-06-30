import { prisma } from '../lib/prisma'
import { getAnchorConfigSync } from './anchor.service'
import { matchTimeRule } from './anchor-rules.service'
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
import { getEffectiveSchedulesForDate } from './anchor-daily-schedule.service'
import { isDateScheduleConfirmed } from './anchor-schedule-confirm.service'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { isPayTimeInSchedule } from '../utils/anchor-schedule-time.util'
import type { AnalyzedOrderView } from '../types/analysis'

export interface OrderAttributionDebugResult {
  ok: boolean
  orderNo: string
  payTime: string
  liveAccountName: string
  finalAnchorName: string
  attributionSource: string
  attributionExplain: string
  matchedSchedule?: {
    anchorName: string
    shopName: string
    startTime: string
    endTime: string
    confirmed: boolean
  }
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
      OR: [
        { orderId: { contains: orderNo } },
        { packageId: { contains: orderNo } },
      ],
    },
    orderBy: { orderTime: 'desc' },
    take: 1,
  })
  return fuzzy[0] ?? null
}

function mapAttributionSource(source: ScheduleAttributionSource): string {
  const map: Record<ScheduleAttributionSource, string> = {
    manual_schedule: 'manual_override',
    default_schedule: 'confirmed_schedule',
    saved_time_rule: 'saved_time_rule',
    template_virtual: 'template_virtual',
    legacy_rule: 'legacy_rule',
    unmatched: 'unmatched',
  }
  return map[source] ?? source
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
      v.orderId === orderNo ||
      v.matchOrderId === orderNo ||
      v.packageId === orderNo,
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
  const before613 =
    payMs != null && payMs < SHOP_SESSION_ANCHOR_CUTOFF_MS
  checkedRules.push({
    ruleName: 'date_cutoff',
    matched: !before613,
    reason: before613
      ? `支付时间早于 ${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE}，走旧规则`
      : `${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE} 起启用排班模板`,
  })

  const config = getAnchorConfigSync()
  const timeRule = payMs != null ? matchTimeRule(new Date(payMs), config) : null
  checkedRules.push({
    ruleName: 'saved_time_rule',
    matched: Boolean(timeRule),
    reason: timeRule
      ? `命中时段规则 ${timeRule.rule.name} → ${timeRule.anchor.name}`
      : '未命中后台保存的时段规则',
  })

  const legacy = resolveAnchorForPerformanceAttribution(view, config)
  checkedRules.push({
    ruleName: 'legacy_rule',
    matched: legacy.anchorName !== '未归属',
    reason:
      legacy.anchorName !== '未归属'
        ? `旧规则/直播号场次 → ${legacy.anchorName}`
        : '旧规则未归属',
  })

  let matchedSchedule: OrderAttributionDebugResult['matchedSchedule'] | undefined
  if (payMs != null && dateKey) {
    const confirmed = await isDateScheduleConfirmed(dateKey)
    const buckets = await getEffectiveSchedulesForDate(dateKey)
    const allRows = [...buckets.manual, ...buckets.generated, ...buckets.virtual]
    for (const row of allRows) {
      if (!orderLiveRoomMatchesSchedule(liveAccountName, row.shopName, row.liveRoomName)) continue
      if (!isPayTimeInSchedule(payMs, row.startAt, row.endAt)) continue
      const startTime = row.startAt.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const endTime = row.endAt.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      matchedSchedule = {
        anchorName: row.anchorName,
        shopName: row.shopName,
        startTime,
        endTime,
        confirmed,
      }
      break
    }
    checkedRules.push({
      ruleName: 'schedule_match',
      matched: Boolean(matchedSchedule),
      reason: matchedSchedule
        ? `命中排班 ${matchedSchedule.shopName} ${matchedSchedule.startTime}-${matchedSchedule.endTime} → ${matchedSchedule.anchorName}（${confirmed ? '已确认' : '未确认'}）`
        : '未命中当天排班时段',
    })
  }

  const resolved = await resolveAnchorWithScheduleOverlay(view)

  return {
    ok: true,
    orderNo,
    payTime,
    liveAccountName,
    finalAnchorName: resolved.anchorName,
    attributionSource: mapAttributionSource(resolved.attributionSource),
    attributionExplain: resolved.attributionExplain,
    matchedSchedule,
    checkedRules,
  }
}
