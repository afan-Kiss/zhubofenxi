/**
 * 经营总览「数据健康」板块静态验收
 *
 * npm run verify:data-health-panel
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { buildBoardSyncMetaForApi } from '../src/services/board-sync-meta.service'

config({ path: path.resolve(__dirname, '../.env') })

const ROOT = path.resolve(__dirname, '../..')
const issues: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8')
}

function main(): void {
  console.log('verify-data-health-panel\n')

  const overview = read('web/src/pages/board/OverviewTab.tsx')
  const provider = read('web/src/providers/BoardLiveQueryProvider.tsx')
  const panel = read('web/src/components/board/DataHealthPanel.tsx')
  const liveAccount = read('web/src/lib/live-account.ts')
  const syncMetaService = read('server/src/services/board-sync-meta.service.ts')
  const boardLiveQuery = read('web/src/lib/board-live-query.ts')
  const signalService = read('server/src/services/after-sale-status-signal.service.ts')
  const operationsAfterSale = read('server/src/services/operations-after-sale-order.util.ts')
  const validRevenue = read('server/src/services/valid-revenue-order.service.ts')
  const metricDetail = read('server/src/services/board-metric-detail.service.ts')

  if (overview.includes('staleMessage')) {
    ok('OverviewTab 使用 staleMessage')
  } else {
    fail('OverviewTab 未使用 staleMessage')
  }

  if (
    overview.includes('<DataHealthPanel') &&
    overview.includes("boardSyncUiMode={boardSyncUiMode}")
  ) {
    ok('OverviewTab 挂载 DataHealthPanel')
  } else {
    fail('OverviewTab 未挂载 DataHealthPanel')
  }

  if (
    panel.includes("'syncing_with_data'") &&
    panel.includes('数据正在更新，当前先展示上一次成功结果')
  ) {
    ok('syncing_with_data 时展示轻量同步提示')
  } else {
    fail('DataHealthPanel 未处理 syncing_with_data 提示')
  }

  if (!overview.includes('有效成交')) {
    ok('OverviewTab 副标题不再出现「有效成交」')
  } else {
    fail('OverviewTab 副标题仍含「有效成交」')
  }

  if (overview.includes('支付、已签收、退款、品退')) {
    ok('OverviewTab 副标题已改为支付、已签收、退款、品退')
  } else {
    fail('OverviewTab 副标题未更新为新口径')
  }

  if (syncMetaService.includes('totalAfterSaleRecords')) {
    ok('board-sync-meta 返回 totalAfterSaleRecords')
  } else {
    fail('board-sync-meta 缺少 totalAfterSaleRecords')
  }

  if (syncMetaService.includes('totalQualityCases')) {
    ok('board-sync-meta 返回 totalQualityCases')
  } else {
    fail('board-sync-meta 缺少 totalQualityCases')
  }

  if (boardLiveQuery.includes('totalAfterSaleRecords') && boardLiveQuery.includes('totalQualityCases')) {
    ok('前端 BoardSyncMeta 类型含售后/品退总量')
  } else {
    fail('前端 BoardSyncMeta 类型缺少售后/品退总量')
  }

  if (provider.includes('totalAfterSaleRecords') && provider.includes('totalQualityCases')) {
    ok('BoardLiveQueryProvider 暴露售后/品退总量')
  } else {
    fail('BoardLiveQueryProvider 未暴露售后/品退总量')
  }

  if (liveAccount.includes('formatShopCookieIssue') && liveAccount.includes('getAccountDisplayName')) {
    ok('Cookie 多异常提示包含店名格式化')
  } else {
    fail('Cookie 多异常提示未包含店名逻辑')
  }

  if (!liveAccount.includes('个直播号 Cookie 暂不可同步，') || liveAccount.includes('formatShopCookieIssue')) {
    ok('Cookie 横幅不再只用数量概括（或已改店名）')
  } else {
    fail('Cookie 横幅仍只用数量概括')
  }

  const bannedWords = ['fallback', 'stale', 'cache', 'dataDisplayStatus', 'activeSyncJob', 'syncMeta']

  function assertNoBannedUserStrings(src: string, label: string): void {
    const literals = src.match(/'[^']*'|"[^"]*"|`[^`]*`/g) ?? []
    for (const word of bannedWords) {
      if (literals.some((lit) => lit.includes(word))) {
        fail(`${label} 用户可见文案出现 ${word}`)
        return
      }
      ok(`${label} 用户可见文案未出现 ${word}`)
    }
  }

  assertNoBannedUserStrings(panel, 'DataHealthPanel')
  assertNoBannedUserStrings(read('web/src/components/board/CookieHealthBanner.tsx'), 'CookieHealthBanner')
  assertNoBannedUserStrings(overview, 'OverviewTab')

  const requiredLabels = [
    '数据健康',
    '最近同步成功',
    '页面读取时间',
    '本地累计订单',
    '本地累计直播场次',
    '本地累计售后',
    '本地累计官方品退',
    'Cookie',
    '滚动30天结账',
  ]
  for (const label of requiredLabels) {
    if (panel.includes(label)) {
      ok(`数据健康区包含「${label}」`)
    } else {
      fail(`数据健康区缺少「${label}」`)
    }
  }

  if (panel.includes('最近同步成功') && !panel.match(/最近同步成功[\s\S]*fetchedAt/)) {
    ok('最近同步成功未使用 fetchedAt 作为展示字段名')
  } else {
    fail('最近同步成功可能仍绑定 fetchedAt')
  }

  if (panel.includes('页面读取时间') && panel.includes('pageFetchedAt')) {
    ok('页面读取时间使用 pageFetchedAt')
  } else {
    fail('页面读取时间未使用 pageFetchedAt')
  }

  if (
    panel.includes('showCookieDetail') &&
    panel.includes('cannotSyncCount') &&
    !panel.includes("tone !== 'warning'")
  ) {
    ok('Cookie 异常店名不会被 staleMessage 隐藏')
  } else {
    fail('Cookie 异常店名仍可能被 staleMessage 隐藏')
  }

  if (provider.includes('pageFetchedAt') && provider.includes('data?.fetchedAt')) {
    ok('Provider 暴露 pageFetchedAt 来自 fetchedAt')
  } else {
    fail('Provider 未正确暴露 pageFetchedAt')
  }

  if (provider.includes('rollingDataHealthClose')) {
    ok('Provider 暴露 rollingDataHealthClose')
  } else {
    fail('Provider 未暴露 rollingDataHealthClose')
  }

  if (syncMetaService.includes('rollingDataHealthClose')) {
    ok('board-sync-meta 返回 rollingDataHealthClose')
  } else {
    fail('board-sync-meta 缺少 rollingDataHealthClose')
  }

  if (provider.includes('缓存重建失败，当前展示上一次成功数据。')) {
    ok('Provider staleMessage 使用缓存失败大白话')
  } else {
    fail('Provider 未使用缓存失败大白话')
  }

  const rollingLabels = [
    '生成时间',
    '售后相关订单',
    '售后信号记录',
    '售后缓存记录',
    '未归属订单',
    '超过一天没更新',
    '全库累计',
  ]
  for (const label of rollingLabels) {
    if (panel.includes(label)) {
      ok(`DataHealthPanel 包含「${label}」`)
    } else {
      fail(`DataHealthPanel 缺少「${label}」`)
    }
  }

  const bannedExtra = ['schema', 'buildMeta', 'monthly close']
  function assertNoExtraBanned(src: string, label: string): void {
    const literals = src.match(/'[^']*'|"[^"]*"|`[^`]*`/g) ?? []
    for (const word of bannedExtra) {
      if (literals.some((lit) => lit.toLowerCase().includes(word))) {
        fail(`${label} 用户可见文案出现 ${word}`)
        return
      }
    }
  }
  assertNoExtraBanned(panel, 'DataHealthPanel')

  if (
    operationsAfterSale.includes('isNoAfterSaleText') &&
    operationsAfterSale.includes('isOperationalAfterSaleText') &&
    !operationsAfterSale.includes('isActualRefundAfterSaleText') &&
    !operationsAfterSale.includes('/售后|退款|退货/')
  ) {
    ok('operations-after-sale 复用公共售后判断且无裸匹配')
  } else {
    fail('operations-after-sale 售后判断未统一')
  }

  if (validRevenue.includes('isNoAfterSaleText')) {
    ok('valid-revenue-order 复用 isNoAfterSaleText')
  } else {
    fail('valid-revenue-order 未复用 isNoAfterSaleText')
  }

  const dedupeBlock = metricDetail.slice(
    metricDetail.indexOf('METRICS_ORDER_DEDUPE'),
    metricDetail.indexOf('METRICS_ORDER_DEDUPE') + 400,
  )
  if (
    dedupeBlock.includes("'returnAmount'") &&
    dedupeBlock.includes("'returnCount'") &&
    dedupeBlock.includes("'returnRate'")
  ) {
    ok('退款类指标抽屉配置 P 单去重')
  } else {
    fail('METRICS_ORDER_DEDUPE 未含退款类指标')
  }

  if (signalService.includes('isNoAfterSaleText') && signalService.includes('viewHasAfterSaleStatusSignal')) {
    ok('存在 after-sale-status-signal 公共模块')
  } else {
    fail('缺少 after-sale-status-signal 公共模块')
  }

  console.log('\n=== API 字段冒烟 ===')
  void buildBoardSyncMetaForApi()
    .then((meta) => {
      if (typeof meta.totalAfterSaleRecords === 'number') {
        ok(`API totalAfterSaleRecords=${meta.totalAfterSaleRecords}`)
      } else {
        fail('API 未返回 totalAfterSaleRecords 数字')
      }
      if (typeof meta.totalQualityCases === 'number') {
        ok(`API totalQualityCases=${meta.totalQualityCases}`)
      } else {
        fail('API 未返回 totalQualityCases 数字')
      }

      console.log('\n=== 结果 ===')
      if (issues.length > 0) {
        console.log(`FAIL (${issues.length})`)
        for (const i of issues) console.log(` - ${i}`)
        process.exit(1)
      }
      console.log('PASS')
    })
    .catch((err) => {
      fail(`buildBoardSyncMetaForApi 调用失败: ${err instanceof Error ? err.message : String(err)}`)
      console.log('\n=== 结果 ===')
      console.log(`FAIL (${issues.length})`)
      for (const i of issues) console.log(` - ${i}`)
      process.exit(1)
    })
}

main()
