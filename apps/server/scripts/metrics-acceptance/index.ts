/**
 * 经营数据 live 库自洽验收：品退、主播 Drawer、买家排行、2026-05-28 口径自洽
 *
 * 用法:
 *   npm run test:metrics
 *   METRICS_BASE_URL=http://127.0.0.1:3001 npm run test:metrics
 *
 * 固定黄金快照请使用: npm run test:metrics:golden
 */
import { getHealth, getJson, MetricsApiError } from './api-client'
import {
  ANCHOR_NAMES,
  BUYER_SUMMARY_CHECKS,
  GOLDEN_DATE,
} from './golden-cases'
import {
  formatMoney,
  hasFailures,
  logFail,
  logPass,
  logSkip,
  logWarn,
  num,
  pickAnchorOrderCount,
  pickPaidAmount,
  pickPaidOrderCount,
  pickQualityReturnCount,
  pickRefundAmount,
  resetResults,
} from './assertions'
import { auditLive20260528 } from './live-audit-20260528'
import { auditShanghaiDateRange } from './timezone-audit'
import { BUYER_RANKING_BUILDING_STALE_MS, BUYER_RANKING_CACHE_VERSION } from '../../src/services/buyer-ranking-cache.service'
import { checkBuyerRankingRuleInvariants } from './buyer-ranking-rule-invariants'
import { checkBuyerDrawerPaidRules } from './buyer-drawer-paid-invariants'

type LocalDataResponse = {
  preset?: string
  startDate?: string
  endDate?: string
  resolvedRange?: { startDate: string; endDate: string }
  summary?: Record<string, unknown>
  anchorLeaderboard?: Array<Record<string, unknown>>
}

type AnchorDrillResponse = {
  anchorId?: string
  anchorName?: string
  stats?: Record<string, unknown> | null
  pagination?: { page: number; pageSize: number; total: number; totalPages: number }
  rows?: Array<Record<string, unknown>>
}

type BuyerProfileResponse = {
  source?: string
  updatedAt?: string | null
  builtAt?: string | null
  orderCount?: number
  rebuilding?: boolean
  cacheVersion?: string | null
  expectedCacheVersion?: string
  cacheCompatible?: boolean
  cacheStale?: boolean
  summary?: {
    highValueCount?: number
    repurchaseCount?: number
    refundCount?: number
    qualityHeavyCount?: number
  }
  items?: unknown[]
}

type BuyerSummaryDrillResponse = {
  summaryKey?: string
  pagination?: { total: number }
}

function detectBuyerProfileState(profile: BuyerProfileResponse): 'ready' | 'building' | 'empty' {
  if (profile.rebuilding) return 'building'
  if (profile.cacheCompatible === false) return 'building'
  const hasCache =
    Boolean(profile.updatedAt || profile.builtAt) &&
    (num(profile.orderCount) > 0 || (profile.items?.length ?? 0) > 0)
  if (hasCache && profile.summary && profile.cacheCompatible !== false) return 'ready'
  if (!profile.updatedAt && !profile.builtAt && num(profile.orderCount) === 0) return 'empty'
  if (profile.summary && profile.updatedAt && profile.cacheCompatible !== false) return 'ready'
  return 'empty'
}

async function checkHealth(): Promise<void> {
  const health = await getHealth()
  if (health.ok) {
    logPass('health', `OK service=${health.service ?? 'live-business-api'}`)
  } else {
    logFail({
      name: 'health',
      message: '服务健康检查失败',
      expected: 'ok=true',
      actual: 'ok!=true',
      url: health.url,
      hint: '请先启动服务：npm run dev',
    })
  }
}

async function checkLive20260528SelfConsistency(): Promise<void> {
  const { url, data } = await getJson<LocalDataResponse>('/api/board/local-data', {
    preset: 'custom',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
  })

  const summary = (data.summary ?? {}) as Record<string, unknown>
  const audit = await auditLive20260528(summary)

  const paidAmount = pickPaidAmount(summary)
  const paidOrders = pickPaidOrderCount(summary)
  const refundAmount = pickRefundAmount(summary)

  if (audit.violations.length === 0) {
    logPass(
      `live:${GOLDEN_DATE}`,
      `OK paidOrders=${paidOrders} paidAmount=${formatMoney(paidAmount)} refundAmount=${formatMoney(refundAmount)}`,
    )
    logPass(`live:${GOLDEN_DATE}:no-unpaid`, 'OK no unpaid orders included')
    logPass(`live:${GOLDEN_DATE}:no-duplicate`, 'OK no duplicate orderNo')
  } else {
    logFail({
      name: `live:${GOLDEN_DATE}`,
      message: 'live 库 2026-05-28 自洽审计失败',
      url,
      fields: {
        api: audit.api,
        pipeline: audit.pipeline,
        anchorSubtotals: audit.anchorSubtotals,
        paidOrderNos: audit.paidOrderNos,
        violations: audit.violations,
      },
      hint: '运行 npm run debug:metrics:20260528 查看明细；固定黄金快照用 npm run test:metrics:golden',
    })
    for (const v of audit.violations) {
      console.error(`  [live-audit] ${v}`)
    }
  }
}

async function checkThisMonthQualityReturn(): Promise<{
  monthData: LocalDataResponse | null
  overviewQuality: number
  anchorQualitySum: number
  buyerQualityHeavy: number | null
}> {
  const { url, data } = await getJson<LocalDataResponse>('/api/board/local-data', {
    preset: 'thisMonth',
  })

  const summary = (data.summary ?? {}) as Record<string, unknown>
  const overviewQuality = pickQualityReturnCount(summary)
  const startDate = data.startDate ?? data.resolvedRange?.startDate ?? ''
  const endDate = data.endDate ?? data.resolvedRange?.endDate ?? ''

  const anchorQualitySum = (data.anchorLeaderboard ?? []).reduce(
    (sum, row) => sum + pickQualityReturnCount(row),
    0,
  )

  let buyerQualityHeavy: number | null = null
  try {
    const { data: profile } = await getJson<BuyerProfileResponse>('/api/board/buyer-profile')
    const state = detectBuyerProfileState(profile)
    if (state === 'ready') {
      buyerQualityHeavy = num(profile.summary?.qualityHeavyCount)
    }
  } catch {
    buyerQualityHeavy = null
  }

  if (overviewQuality > 0 && anchorQualitySum > 0) {
    const buyerPart =
      buyerQualityHeavy != null ? ` buyers=${buyerQualityHeavy}` : ''
    logPass(
      'quality-return:thisMonth',
      `OK overview=${overviewQuality} anchors=${anchorQualitySum}${buyerPart} range=${startDate}~${endDate}`,
    )
  } else {
    if (overviewQuality <= 0) {
      logFail({
        name: 'quality-return:thisMonth:overview',
        message: '本月经营总览品退单数不应无理由为 0',
        expected: '>0',
        actual: overviewQuality,
        url,
        fields: { qualityReturnCount: summary.qualityReturnCount, startDate, endDate },
        hint: '检查官方品质负反馈同步与 strictQualityRefund 判定',
      })
    }
    if (anchorQualitySum <= 0) {
      logFail({
        name: 'quality-return:thisMonth:anchors',
        message: '本月主播业绩品退指标不应全部为 0',
        expected: 'anchorLeaderboard 品退合计 > 0',
        actual: anchorQualitySum,
        url,
        hint: '核对主播归属与品退交叉印证逻辑',
      })
    }
  }

  if (overviewQuality > 0 && buyerQualityHeavy === 0) {
    logFail({
      name: 'quality-return:thisMonth:buyers',
      message: '经营总览有品退但买家排行品退客户数为 0',
      expected: '>0',
      actual: 0,
      hint: '检查 buyer-ranking-cache 是否在品退同步后重建',
    })
  }

  return { monthData: data, overviewQuality, anchorQualitySum, buyerQualityHeavy }
}

async function checkAnchorDrillConsistency(monthData: LocalDataResponse): Promise<void> {
  const startDate = monthData.startDate ?? monthData.resolvedRange?.startDate
  const endDate = monthData.endDate ?? monthData.resolvedRange?.endDate
  if (!startDate || !endDate) {
    logFail({
      name: 'anchor:range',
      message: '无法解析本月日期范围',
      url: '/api/board/local-data?preset=thisMonth',
      hint: '检查 local-data 返回 startDate/endDate',
    })
    return
  }

  const leaderboard = monthData.anchorLeaderboard ?? []
  const drillTotals: Record<string, number> = {}

  for (const anchorName of ANCHOR_NAMES) {
    const card = leaderboard.find((r) => String(r.anchorName ?? '').trim() === anchorName)
    if (!card) {
      logFail({
        name: `anchor:${anchorName}`,
        message: '主播业绩卡片未找到',
        expected: anchorName,
        actual: 'not found',
        url: '/api/board/local-data?preset=thisMonth',
        hint: '确认主播配置与本月订单归属',
      })
      continue
    }

    const cardOrders = pickAnchorOrderCount(card)
    const anchorId = card.anchorId ? String(card.anchorId) : undefined

    const { url, data } = await getJson<AnchorDrillResponse>('/api/board/anchor-drill', {
      startDate,
      endDate,
      anchorName,
      anchorId,
      page: 1,
      pageSize: 20,
      statusType: 'all',
    })

    const drawerTotal = num(data.pagination?.total)
    drillTotals[anchorName] = drawerTotal
    const statsName = String(data.stats?.anchorName ?? data.anchorName ?? '')

    if (statsName && statsName !== anchorName) {
      logFail({
        name: `anchor:${anchorName}:name`,
        message: 'Drawer stats 主播名与请求不一致',
        expected: anchorName,
        actual: statsName,
        url,
        hint: '检查 anchor-drill 归属过滤是否串数据',
      })
    }

    if (cardOrders > 0 && drawerTotal === 0) {
      logFail({
        name: `anchor:${anchorName}`,
        message: '卡片有订单但 Drawer total 为 0',
        expected: cardOrders,
        actual: drawerTotal,
        url,
        fields: { cardOrders, drawerTotal, anchorId },
        hint: '检查 loadBoardArtifactsForRange 与 anchor 过滤',
      })
      continue
    }

    if (cardOrders !== drawerTotal) {
      logFail({
        name: `anchor:${anchorName}`,
        message: '卡片订单数与 Drawer pagination.total 不一致',
        expected: cardOrders,
        actual: drawerTotal,
        url,
        fields: {
          cardOrderCount: card.orderCount,
          cardPaidOrderCount: card.paidOrderCount,
          pagination: data.pagination,
        },
        hint: '卡片 orderCount 与 anchor-drill 过滤后 rows 总数应一致',
      })
      continue
    }

    logPass(`anchor:${anchorName}`, `cardOrders=${cardOrders} drawerTotal=${drawerTotal}`)
  }

  const zijieTotal = drillTotals['子杰']
  const feiyunTotal = drillTotals['飞云']
  if (zijieTotal != null && feiyunTotal != null && zijieTotal > 0 && feiyunTotal > 0) {
    const { url, data } = await getJson<AnchorDrillResponse>('/api/board/anchor-drill', {
      startDate,
      endDate,
      anchorName: '飞云',
      page: 1,
      pageSize: 20,
      statusType: 'all',
    })
    const wrongRows = (data.rows ?? []).filter(
      (r) => String(r.anchorName ?? '').trim() === '子杰',
    )
    if (wrongRows.length > 0) {
      logFail({
        name: 'anchor:feiyun:not-zijie',
        message: '飞云 Drawer 出现子杰订单',
        expected: 0,
        actual: wrongRows.length,
        url,
        hint: '检查 viewBelongsToAnchor 过滤',
      })
    } else {
      logPass('anchor:cross-check', '子杰/飞云 Drawer 未串数据')
    }
  }
}

type SyncMetaResponse = {
  buyerProfileStatus?: {
    status?: string
    lastSuccessAt?: string | null
    runningSeconds?: number | null
    isStaleRunning?: boolean
    lastError?: string | null
    cacheVersion?: string | null
    expectedCacheVersion?: string
    cacheCompatible?: boolean
    rebuildScheduled?: boolean
  }
}

async function checkBuyerProfileBuildingGuard(): Promise<void> {
  try {
    const { url, data } = await getJson<SyncMetaResponse>('/api/board/sync-meta')
    const st = data.buyerProfileStatus
    if (!st) {
      logSkip('buyer-profile:status', 'sync-meta 无 buyerProfileStatus')
      return
    }
    const status = String(st.status ?? '')
    const lastSuccess = st.lastSuccessAt
    const runningSec = num(st.runningSeconds)
    const isStale = Boolean(st.isStaleRunning) || status === 'stale'

    if (
      (status === 'building' ||
        status === 'rebuilding' ||
        status === 'stale' ||
        status === 'stale_with_cache') &&
      !lastSuccess
    ) {
      if (runningSec * 1000 >= BUYER_RANKING_BUILDING_STALE_MS || isStale) {
        logFail({
          name: 'buyer-profile:building-stale',
          message: 'buyer profile building 超时且无 lastSuccessAt',
          url,
          fields: { status, runningSeconds: runningSec, lastError: st.lastError },
          hint: '检查 buyer-ranking-cache 超时释放逻辑',
        })
      } else {
        logSkip('buyer-profile:building', 'building 中且无缓存，尚在阈值内')
      }
      return
    }

    if ((status === 'building' || status === 'rebuilding' || status === 'stale') && lastSuccess) {
      logWarn(
        'buyer-profile:building-cache',
        `building/stale 但有 lastSuccessAt=${lastSuccess}，展示旧缓存（WARN）`,
      )
      return
    }

    if (status === 'ready') {
      logPass('buyer-profile:status', 'ready')
    }
  } catch (err) {
    logSkip('buyer-profile:status', `无法读取 sync-meta: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function checkBuyerProfileCacheVersion(): Promise<void> {
  const { url, data } = await getJson<BuyerProfileResponse>('/api/board/buyer-profile')
  const expected = data.expectedCacheVersion ?? BUYER_RANKING_CACHE_VERSION
  const version = String(data.cacheVersion ?? '')

  if (data.rebuilding || data.cacheCompatible === false || data.cacheStale) {
    try {
      const { data: meta } = await getJson<SyncMetaResponse>('/api/board/sync-meta')
      const st = meta.buyerProfileStatus
      if (
        st?.status === 'building' ||
        st?.status === 'rebuilding' ||
        st?.rebuilding ||
        st?.rebuildScheduled ||
        st?.cacheCompatible === false
      ) {
        logPass(
          'buyer-profile:cache-version-rebuild',
          `旧缓存已触发自动重建 status=${st.status ?? 'unknown'} version=${version || 'none'}`,
        )
      } else {
        logWarn(
          'buyer-profile:cache-version-rebuild',
          `cache 需升级但 sync-meta 未标记 building version=${version || 'none'}`,
        )
      }
    } catch {
      logSkip('buyer-profile:cache-version-rebuild', '无法读取 sync-meta')
    }
    return
  }

  if (version === expected) {
    logPass('buyer-profile:cache-version', `OK cacheVersion=${version}`)
  } else {
    logFail({
      name: 'buyer-profile:cache-version',
      message: 'buyer profile cacheVersion 与当前版本不一致',
      expected,
      actual: version || '(empty)',
      url,
    })
  }
}

async function checkBuyerRankingSummary(): Promise<boolean> {
  const { url, data } = await getJson<BuyerProfileResponse>('/api/board/buyer-profile')
  const state = detectBuyerProfileState(data)

  if (state === 'building') {
    logSkip('buyer-ranking', 'buyer profile building，跳过 ready 专用 summary 断言')
    return false
  }

  if (state === 'empty') {
    logSkip('buyer-ranking', 'buyer profile 尚未生成，跳过 summary 断言')
    return false
  }

  const summary = data.summary ?? {}
  let allMatch = true

  for (const check of BUYER_SUMMARY_CHECKS) {
    const expected = num(summary[check.summaryField as keyof typeof summary])
    const { url: drillUrl, data: drill } = await getJson<BuyerSummaryDrillResponse>(
      '/api/board/buyer-ranking/summary-drill',
      { summaryKey: check.summaryKey, page: 1, pageSize: 1 },
    )
    const actual = num(drill.pagination?.total)

    if (expected === actual) {
      logPass(
        `buyer-ranking:${check.summaryKey}`,
        `${check.label} summary=${expected} listTotal=${actual}`,
      )
    } else {
      allMatch = false
      logFail({
        name: `buyer-ranking:${check.summaryKey}`,
        message: `${check.label} summary 与列表 total 不一致`,
        expected,
        actual,
        url: drillUrl,
        fields: {
          summaryField: check.summaryField,
          summaryValue: summary[check.summaryField as keyof typeof summary],
          pagination: drill.pagination,
          profileUrl: url,
        },
        hint: '检查 buyer-ranking-cache summary 与 summary-drill 过滤函数是否一致',
      })
    }
  }

  if (allMatch) {
    logPass('buyer-ranking', 'OK summary matches drill totals')
  }
  return true
}

async function checkQualityBadCaseSyncRules(): Promise<void> {
  try {
    const { url, data } = await getJson<{
      qualityBadCase?: {
        candidateAccounts?: Array<{ id: string; name: string }>
        attemptsXiaohongshuAsDisplayName?: boolean
      }
    }>('/api/board/sync-debug')
    const qb = data.qualityBadCase
    if (!qb) {
      logSkip('metrics:quality-sync-debug', '无 qualityBadCase debug 段')
      return
    }
    const badName = (qb.candidateAccounts ?? []).some((a) => a.name === 'xiaohongshu')
    if (badName || qb.attemptsXiaohongshuAsDisplayName) {
      logFail({
        name: 'metrics:quality-no-xhs-sync',
        message: '品退同步不应以 xiaohongshu 作为显示账号名',
        url,
      })
    } else {
      logPass('metrics:quality-no-xhs-sync', 'OK 品退同步账号名非 xiaohongshu')
    }
  } catch {
    logSkip('metrics:quality-sync-debug', 'sync-debug 不可用')
  }
}

async function main(): Promise<void> {
  resetResults()
  console.log('[metrics-acceptance] 开始 live 库自洽验收\n')

  try {
    await checkHealth()
    if (hasFailures()) {
      finish(1)
      return
    }

    auditShanghaiDateRange()
    await checkLive20260528SelfConsistency()
    const { monthData } = await checkThisMonthQualityReturn()
    if (monthData) {
      await checkAnchorDrillConsistency(monthData)
    }
    await checkBuyerProfileBuildingGuard()
    await checkBuyerProfileCacheVersion()
    const profileReady = await checkBuyerRankingSummary()
    await checkBuyerRankingRuleInvariants(profileReady)
    await checkBuyerDrawerPaidRules(profileReady)
    await checkQualityBadCaseSyncRules()
  } catch (err) {
    if (err instanceof MetricsApiError) {
      logFail({
        name: 'metrics-api',
        message: err.message,
        url: err.meta.url,
        fields: { status: err.meta.status, body: err.meta.body },
        hint: '确认服务已启动且 /api/board/* 路由可访问',
      })
    } else {
      console.error('[metrics-acceptance] 未捕获异常:', err)
      logFail({
        name: 'metrics-acceptance',
        message: err instanceof Error ? err.message : String(err),
        hint: '查看上方堆栈',
      })
    }
  }

  finish(hasFailures() ? 1 : 0)
}

function finish(code: number): void {
  console.log('')
  if (code === 0) {
    console.log('[metrics-acceptance] PASS')
  } else {
    console.error('[metrics-acceptance] FAIL')
  }
  process.exit(code)
}

main()

