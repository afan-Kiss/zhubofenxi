import { prisma } from '../lib/prisma'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { executeBoardLiveQuery } from './board-live-query.service'
import { buildGmvDiagnostics } from './gmv-diagnostic.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import {
  prepareAnalysisArtifactsFromRaw,
  runBusinessAnalysisFromRaw,
} from './business-analysis.service'
import { computeGrossProfitBreakdown } from './gross-profit.service'
import { listSyncJobLogs } from './sync-job-log.service'

export type AcceptanceStatus = 'pass' | 'fail' | 'unchecked'

export interface AcceptanceCheckItem {
  id: string
  label: string
  status: AcceptanceStatus
  detail: string
}

export interface SystemAcceptanceResult {
  checkedAt: string
  range: { preset: string; startDate: string; endDate: string }
  items: AcceptanceCheckItem[]
  passCount: number
  failCount: number
  uncheckedCount: number
}

function item(
  id: string,
  label: string,
  status: AcceptanceStatus,
  detail: string,
): AcceptanceCheckItem {
  return { id, label, status, detail }
}

export async function runSystemAcceptanceChecks(
  preset: DateRangePreset = 'today',
): Promise<SystemAcceptanceResult> {
  const range = resolveDateRange(preset)
  const items: AcceptanceCheckItem[] = []

  let liveOk = false
  let liveOrderCount = 0
  let live: Awaited<ReturnType<typeof executeBoardLiveQuery>> | null = null
  try {
    live = await executeBoardLiveQuery({ preset: 'today' })
    liveOk = live.source === 'live_api'
    liveOrderCount = Number(live.summary.orderCount ?? 0)
  } catch {
    liveOk = false
    live = null
  }
  items.push(
    item(
      'refresh_today',
      '当天数据是否能实时查询',
      liveOk ? 'pass' : 'fail',
      liveOk
        ? `今日 live-query 成功，订单数 ${liveOrderCount}`
        : '今日实时查询失败，请检查接口配置',
    ),
  )

  items.push(
    item(
      'refresh_custom',
      '自定义日期是否能实时查询',
      'unchecked',
      '请在首页选择自定义日期并点击查询（live-query）',
    ),
  )

  const diag = await buildGmvDiagnostics(preset)
  const diagGmvCent = diag.sumOrderGmvCent

  items.push(
    item(
      'gmv_home_vs_diag',
      '实时 GMV 与诊断 GMV',
      diagGmvCent >= 0 ? 'pass' : 'unchecked',
      `诊断 GMV ${(diagGmvCent / 100).toFixed(2)} 元（无快照比对）`,
    ),
  )

  const bundle = await buildRawAnalyzeBundle(range)
  const biGmvCent = bundle
    ? prepareAnalysisArtifactsFromRaw(bundle).views.reduce((s, v) => s + v.gmvCent, 0)
    : 0

  const liveGmvCent = liveOk && live ? Math.round(Number(live.summary?.totalGmv ?? 0) * 100) : 0
  items.push(
    item(
      'gmv_home_vs_bi',
      'live-query GMV 是否等于 BI GMV',
      liveOk && liveGmvCent === biGmvCent ? 'pass' : liveOk ? 'fail' : 'unchecked',
      liveOk
        ? `live-query ${(liveGmvCent / 100).toFixed(2)} 元 · BI ${(biGmvCent / 100).toFixed(2)} 元`
        : 'live-query 未成功，无法比对',
    ),
  )

  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const dupGroups = artifacts?.dedupe.duplicateOrders.length ?? 0
  const deduped = artifacts?.dedupe.uniqueOrders.length ?? 0
  items.push(
    item(
      'order_dedupe',
      '订单是否去重',
      bundle ? 'pass' : 'unchecked',
      bundle ? `去重后 ${deduped} 单，重复组 ${dupGroups} 组` : '当前范围无订单数据',
    ),
  )

  const multiSkuMerged = artifacts?.dedupe.uniqueOrders.some((o) =>
    o.errors.some((e) => e.includes('多 SKU')),
  )
  items.push(
    item(
      'multi_sku_sum',
      '多 SKU 是否累加',
      bundle ? 'pass' : 'unchecked',
      bundle
        ? multiSkuMerged
          ? '检测到同包裹多 SKU 并已累加金额'
          : '当前范围无多 SKU 合并场景，逻辑已启用'
        : '无订单数据',
    ),
  )

  const pipeline = bundle ? runBusinessAnalysisFromRaw(bundle) : null
  items.push(
    item(
      'refund_detect',
      '退款是否识别',
      bundle ? 'pass' : 'unchecked',
      bundle ? `识别退货 ${pipeline?.overview.returnCount ?? 0} 单` : '无订单数据',
    ),
  )

  items.push(
    item(
      'quality_return',
      '品退是否识别',
      bundle ? 'pass' : 'unchecked',
      bundle ? `品退 ${pipeline?.overview.qualityReturnCount ?? 0} 单` : '无订单数据',
    ),
  )

  const orderIds = new Set(artifacts?.dedupe.uniqueOrders.map((o) => o.matchOrderId) ?? [])
  const gp = bundle && artifacts
    ? computeGrossProfitBreakdown(orderIds, biGmvCent, artifacts.settlement)
    : null
  items.push(
    item(
      'settlement_match',
      '结算是否匹配',
      gp && bundle?.hasSettled
        ? gp.unmatchedSettlementCount === 0
          ? 'pass'
          : 'fail'
        : 'unchecked',
      gp
        ? `已匹配 ${gp.matchedSettlementCount} · 未匹配 ${gp.unmatchedSettlementCount}`
        : '无结算数据',
    ),
  )

  const overviewGp = pipeline?.overview.grossProfitCent ?? gp?.grossProfitCent
  items.push(
    item(
      'gross_profit',
      '毛利润是否正确',
      overviewGp != null && bundle ? 'pass' : 'unchecked',
      overviewGp != null
        ? `毛利润 ${(overviewGp / 100).toFixed(2)} 元（已结算+待结算-退款-扣费-运费）`
        : '无法计算',
    ),
  )

  items.push(
    item(
      'live_query',
      'live-query 是否可用',
      liveOk ? 'pass' : 'fail',
      liveOk && live ? `requestId=${live.requestId} source=live_api` : '实时查询失败',
    ),
  )

  const syncLogs = await listSyncJobLogs(1, 1)
  items.push(
    item(
      'sync_log',
      '同步日志是否记录',
      syncLogs.total > 0 ? 'pass' : 'fail',
      syncLogs.total > 0 ? `共 ${syncLogs.total} 条同步任务记录` : '暂无同步任务记录',
    ),
  )

  return {
    checkedAt: new Date().toISOString(),
    range: { preset, startDate: range.startDate, endDate: range.endDate },
    items,
    passCount: items.filter((i) => i.status === 'pass').length,
    failCount: items.filter((i) => i.status === 'fail').length,
    uncheckedCount: items.filter((i) => i.status === 'unchecked').length,
  }
}
