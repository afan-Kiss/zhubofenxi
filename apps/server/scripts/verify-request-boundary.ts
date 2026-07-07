/**
 * 请求职责边界验收：经营总览 / 买家排行 / 售后 / 品退 / 定时任务
 *
 * npm run verify:request-boundary
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const issues: string[] = []
const warnings: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`  ⚠ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8')
}

function assertForbidden(
  src: string,
  label: string,
  patterns: string[],
): void {
  for (const p of patterns) {
    if (src.includes(p)) {
      fail(`${label} 含禁止调用 ${p}`)
    } else {
      ok(`${label} 未含 ${p}`)
    }
  }
}

interface BoundaryRow {
  feature: string
  entry: string
  readsDb: string
  platformApi: string
  apis: string
  triggersOther: string
  allowed: string
}

const FORBIDDEN_PLATFORM = [
  'requestXhsJsonWithSyncAudit',
  'enqueueXhsRequest',
  'syncOrderList',
  'syncLiveSessionList',
  'fetchAfterSalesWorkbenchByOrderNo',
  'syncWorkbenchForOrderNo',
  'processWorkbenchQueueBatch',
  'runOfficialQualityBadCaseSyncStep',
  'syncAfterSalesTimeSearchForRange',
] as const

function printStructureTable(): void {
  console.log('\n=== 功能 / 接口职责结构表 ===\n')
  const rows: BoundaryRow[] = [
    {
      feature: '经营总览 GET',
      entry: 'GET /api/board/local-data → executeBoardLocalQuery',
      readsDb: '是（businessBoardCache / xhsRawOrder 经 getOrBuildBusinessBoardCache）',
      platformApi: '否（读路径）',
      apis: '无',
      triggersOther: '否（不触发买家排行重建）；AUTO_SYNC 默认 false',
      allowed: '是',
    },
    {
      feature: '经营缓存构建',
      entry: 'getOrBuildBusinessBoardCache → loadBoardArtifactsForRange → buildRawAnalyzeBundle',
      readsDb: '是（订单/直播/售后缓存/品退缓存/时间查询缓存）',
      platformApi: '否',
      apis: 'loadAfterSalesBundleForOrderNos / loadAfterSalesTimeSearchByOrderNo / bootstrapQualityBadCaseCache',
      triggersOther: '否',
      allowed: '是',
    },
    {
      feature: '买家排行重建',
      entry: 'rebuildBuyerRankingCache → executeRebuildBuyerRankingCache',
      readsDb: '是（buildRawAnalyzeBundleAll + 本地售后/品退缓存）',
      platformApi: '否（已移除工作台 warm/queue）',
      apis: '无平台 API',
      triggersOther: '否',
      allowed: '是',
    },
    {
      feature: '买家排行 GET',
      entry: 'GET /api/board/buyer-profile → getBuyerRankingProfile',
      readsDb: '是（buyerRankingCache 表）',
      platformApi: '否',
      apis: '无',
      triggersOther: 'POST auto-rebuild 才排队重建',
      allowed: '是',
    },
    {
      feature: '经营定时同步',
      entry: 'scheduleBusinessPeriodicSync → runNormalBusinessSyncJob → runDailyStrategySyncJob(business_core)',
      readsDb: '是（写 xhsRawOrder / xhsRawLiveSession）',
      platformApi: '是',
      apis: 'syncOrderList + syncLiveSessionList（品退已拆出 business_core）',
      triggersOther: 'invalidateAndRebuildBusinessBoardCache；不跑买家排行/售后工作台',
      allowed: '是',
    },
    {
      feature: '售后工作台补查',
      entry: 'scheduleWorkbenchQueueProcessor → runAfterSalesBackfillBatch',
      readsDb: '是（队列 + 缓存表）',
      platformApi: '是',
      apis: 'fetchAfterSalesWorkbenchByOrderNo（经 backfill 批次）',
      triggersOther: '独立 cron，不被看板/排行触发',
      allowed: '是',
    },
    {
      feature: '官方品退同步',
      entry: 'runOfficialQualityBadCaseSyncStep（manual / quality_only 模式）',
      readsDb: '是',
      platformApi: '是',
      apis: '官方品退 API',
      triggersOther: 'business_core 已跳过',
      allowed: '是（独立任务）',
    },
    {
      feature: '滚动30天数据健康',
      entry: 'scheduleRollingDataHealthClose 03:10 + startup catchup + POST manual',
      readsDb: '是（本地分析包）',
      platformApi: '否',
      apis: '无',
      triggersOther: '已从买家排行 finally 移除',
      allowed: '是',
    },
    {
      feature: '买家排行定时',
      entry: 'scheduleBuyerRankingCache 03:00',
      readsDb: '是',
      platformApi: '否',
      apis: '无',
      triggersOther: '不触发滚动数据健康',
      allowed: '是',
    },
  ]

  const header = ['功能', '入口', '读DB', '平台API', '请求API', '触发其他任务', '允许']
  const colWidths = [14, 42, 8, 10, 28, 22, 6]
  console.log(header.map((h, i) => h.padEnd(colWidths[i]!)).join(' | '))
  console.log(colWidths.map((w) => '-'.repeat(w)).join('-+-'))
  for (const r of rows) {
    const cells = [
      r.feature,
      r.entry.slice(0, 40),
      r.readsDb === '是（businessBoardCache / xhsRawOrder 经 getOrBuildBusinessBoardCache）' ? '是' : r.readsDb.startsWith('是') ? '是' : '否',
      r.platformApi.startsWith('是') ? '是' : '否',
      r.apis.slice(0, 26),
      r.triggersOther.slice(0, 20),
      r.allowed,
    ]
    console.log(cells.map((c, i) => c.padEnd(colWidths[i]!)).join(' | '))
  }
}

function checkBoardLocalQueryStatic(): void {
  console.log('\n=== 静态：board-local-query ===')
  const src = read('server/src/services/board-local-query.service.ts')
  assertForbidden(src, 'board-local-query', [...FORBIDDEN_PLATFORM])
  if (src.includes("AUTO_SYNC_ON_VIEW_MISSING === 'true'")) {
    ok('AUTO_SYNC_ON_VIEW_MISSING 默认 false（需显式 env=true）')
  } else {
    fail('AUTO_SYNC_ON_VIEW_MISSING 默认值不明')
  }
  if (!src.includes('rebuildBuyerRankingCache') && !src.includes('scheduleBuyerRankingCacheRebuild')) {
    ok('board-local-query 不触发买家排行重建')
  } else {
    fail('board-local-query 可能触发买家排行重建')
  }
}

function checkBuyerRankingCacheStatic(): void {
  console.log('\n=== 静态：buyer-ranking-cache ===')
  const src = read('server/src/services/buyer-ranking-cache.service.ts')
  assertForbidden(src, 'buyer-ranking-cache', [...FORBIDDEN_PLATFORM])
  if (src.includes('BUYER_RANKING_LOCAL_CACHE_ONLY_HINT')) {
    ok('买家排行状态含本地缓存提示文案')
  } else {
    fail('买家排行缺少本地缓存提示')
  }
  if (!src.includes('warmWorkbenchCacheForOrders') && !src.includes('processWorkbenchQueueBatch')) {
    ok('买家排行重建未引用工作台 warm/queue')
  } else {
    fail('买家排行重建仍引用工作台 warm/queue')
  }
}

function checkBoardAnalysisReadStatic(): void {
  console.log('\n=== 静态：经营读分析包 ===')
  const metrics = read('server/src/services/board-metrics.service.ts')
  const raw = read('server/src/services/xhs-api-sync/xhs-analysis-from-raw.service.ts')

  for (const p of ['syncAfterSalesTimeSearchForRange', 'fetchAfterSalesWorkbenchByOrderNo']) {
    if (raw.includes(p)) {
      fail(`xhs-analysis-from-raw 读路径含 ${p}`)
    } else {
      ok(`xhs-analysis-from-raw 读路径未含 ${p}`)
    }
  }
  if (raw.includes('loadAfterSalesBundleForOrderNos') && raw.includes('loadAfterSalesTimeSearchByOrderNo')) {
    ok('xhs-analysis-from-raw 使用本地售后缓存加载函数')
  } else {
    fail('xhs-analysis-from-raw 未使用本地售后缓存加载')
  }
  if (metrics.includes('loadBoardArtifactsForRange') && metrics.includes('buildRawAnalyzeBundle')) {
    ok('board-metrics 经 buildRawAnalyzeBundle 读本地包')
  } else {
    fail('board-metrics 读路径异常')
  }
  assertForbidden(metrics, 'board-metrics.loadBoardArtifactsForRange 区域', [
    'syncAfterSalesTimeSearchForRange',
    'fetchAfterSalesWorkbenchByOrderNo',
    'processWorkbenchQueueBatch',
  ])
}

function checkSchedulerStatic(): void {
  console.log('\n=== 静态：scheduler ===')
  const src = read('server/src/services/scheduler.service.ts')

  const buyerBlock = src.slice(
    src.indexOf('function scheduleBuyerRankingCache'),
    src.indexOf('function scheduleBuyerRankingCache') + 1200,
  )
  if (!buyerBlock.includes('runRollingDataHealthClose')) {
    ok('买家排行 cron 未调用 runRollingDataHealthClose')
  } else {
    fail('买家排行 cron 仍调用 runRollingDataHealthClose')
  }

  if (src.includes('function scheduleRollingDataHealthClose')) {
    ok('存在独立 scheduleRollingDataHealthClose')
  } else {
    fail('缺少 scheduleRollingDataHealthClose')
  }

  if (src.includes('ROLLING_DATA_HEALTH_CLOSE_DAILY_TIME')) {
    ok('滚动数据健康独立 cron 时间常量')
  } else {
    fail('缺少 ROLLING_DATA_HEALTH_CLOSE_DAILY_TIME')
  }

  if (src.includes('scheduleRollingDataHealthCloseStartupCatchup')) {
    ok('启动时滚动数据健康补跑')
  } else {
    fail('缺少启动补跑 scheduleRollingDataHealthCloseStartupCatchup')
  }

  const workbenchBlock = src.slice(
    src.indexOf('function scheduleWorkbenchQueueProcessor'),
    src.indexOf('function scheduleWorkbenchQueueProcessor') + 600,
  )
  if (workbenchBlock.includes('runAfterSalesBackfillBatch')) {
    ok('workbench cron 仅调用 runAfterSalesBackfillBatch')
  } else {
    fail('workbench cron 未限定售后补查任务')
  }

  const periodicBlock = src.slice(
    src.indexOf('async function runBusinessPeriodicSyncTick'),
    src.indexOf('async function runBusinessPeriodicSyncTick') + 500,
  )
  if (periodicBlock.includes('runNormalBusinessSyncJob')) {
    ok('经营 periodic sync 调用 runNormalBusinessSyncJob')
  } else {
    fail('经营 periodic sync 未调用 runNormalBusinessSyncJob')
  }
}

function checkDailySyncStrategyStatic(): void {
  console.log('\n=== 静态：daily-sync-strategy ===')
  const src = read('server/src/services/daily-sync-strategy.service.ts')

  if (src.includes("export type BusinessSyncMode")) {
    ok('存在 BusinessSyncMode 类型')
  } else {
    fail('缺少 BusinessSyncMode')
  }

  if (src.includes("DEFAULT_BUSINESS_SYNC_MODE: BusinessSyncMode = 'business_core'")) {
    ok('默认模式 business_core')
  } else {
    fail('默认模式非 business_core')
  }

  if (
    src.includes("mode === 'business_with_quality'") &&
    src.includes('shouldSyncQuality')
  ) {
    ok('品退同步受 mode 控制')
  } else {
    fail('品退同步未受 mode 控制')
  }

  if (src.includes('fetchAfterSalesWorkbenchByOrderNo') || src.includes('processWorkbenchQueueBatch')) {
    fail('daily-sync-strategy 含售后工作台 API 调用')
  } else {
    ok('daily-sync-strategy 无售后工作台 API')
  }

  if (src.includes('runOfficialQualityBadCaseSyncStep')) {
    warn('daily-sync-strategy 仍含 runOfficialQualityBadCaseSyncStep（business_core 已跳过，maintenance 模式仍可用）')
  }
}

function checkBusinessSyncSchedulerStatic(): void {
  console.log('\n=== 静态：business-sync-scheduler ===')
  const src = read('server/src/services/business-sync-scheduler.service.ts')
  if (src.includes('mode: DEFAULT_BUSINESS_SYNC_MODE')) {
    ok('runNormalBusinessSyncJob 传递 business_core 模式')
  } else {
    fail('runNormalBusinessSyncJob 未传递 business_core')
  }
}

function main(): void {
  console.log('verify-request-boundary\n')
  printStructureTable()
  checkBoardLocalQueryStatic()
  checkBuyerRankingCacheStatic()
  checkBoardAnalysisReadStatic()
  checkSchedulerStatic()
  checkDailySyncStrategyStatic()
  checkBusinessSyncSchedulerStatic()

  console.log('\n=== 结果 ===')
  if (warnings.length > 0) {
    console.log(`WARN (${warnings.length})`)
    for (const w of warnings) console.log(`  - ${w}`)
  }
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(`  - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

main()
