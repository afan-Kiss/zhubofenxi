import type { UserRole } from '../types/roles'
import { executeBoardLiveQuery } from './board-live-query.service'
import { normalizeBoardPreset } from './board-metrics.service'
import type { DateRangePreset } from '../utils/date-range'

export type BoardOverviewLoadStatus =
  | 'ready'
  | 'syncing'
  | 'sync_failed'
  | 'api_not_configured'
  | 'empty_after_sync'
  | 'no_data'

export async function loadBoardOverviewWithAutoFill(params: {
  preset: string
  startDate?: string
  endDate?: string
  role: UserRole
  syncJobId?: string
  triggeredBy?: string | null
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<{
  status: BoardOverviewLoadStatus
  message?: string
  syncJob?: null
  overview?: {
    hasData: boolean
    message: string
    range: {
      preset: string
      startDate: string
      endDate: string
      rangeLabel: string
    }
    snapshot: Record<string, unknown> | null
    source: 'live_api'
    isFromCache: false
  }
}> {
  void params.role
  void params.syncJobId
  try {
    const result = await executeBoardLiveQuery(
      {
        preset: params.preset as import('./board-live-query.service').BoardLiveQueryPreset,
        startDate: params.startDate,
        endDate: params.endDate,
        triggeredBy: params.triggeredBy,
        audit: params.audit,
      },
      undefined,
    )
    const normalized = normalizeBoardPreset(params.preset) as DateRangePreset
    const hasData = Number(result.summary.orderCount ?? 0) > 0
    return {
      status: hasData ? 'ready' : 'no_data',
      message: hasData
        ? `已加载 ${result.startDate} ~ ${result.endDate} 经营数据`
        : '当前范围暂无订单数据',
      overview: {
        hasData,
        message: hasData
          ? `已加载 ${result.startDate} ~ ${result.endDate} 经营数据`
          : '当前范围暂无订单数据',
        range: {
          preset: params.preset,
          startDate: result.startDate,
          endDate: result.endDate,
          rangeLabel: `${result.startDate} ~ ${result.endDate}`,
        },
        snapshot: {
          ...result.summary,
          anchorLeaderboard: result.anchorLeaderboard,
          blacklistedBuyerIds: result.blacklistedBuyerIds,
        },
        source: 'live_api',
        isFromCache: false,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '实时查询失败'
    if (/未配置/.test(msg)) {
      return { status: 'api_not_configured', message: msg }
    }
    return { status: 'sync_failed', message: msg }
  }
}
