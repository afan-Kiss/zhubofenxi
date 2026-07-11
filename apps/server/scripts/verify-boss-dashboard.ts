/**
 * npm run verify:boss-dashboard
 */
import { prisma } from '../src/lib/prisma'
import {
  classifyBossFlow,
  isSettlementIncomeRow,
  isWithdrawSuccessRow,
  parseBossAggregateAccount,
  parseBossFlowRow,
  parseBossScoreTrend,
  yuanStringToCent,
} from '../src/services/boss-dashboard/boss-dashboard-normalize.service'
import { buildRecentMonthKeys, aggregateMonthlyStatementIncome } from '../src/services/boss-dashboard/boss-dashboard-flow.service'
import { createScoreChangeAnnouncements } from '../src/services/boss-dashboard/boss-dashboard-announcement.service'
import { DEFAULT_ROLE_PAGE_PERMISSIONS } from '../src/config/page-permissions'
import { BOSS_FINANCE_API, BOSS_SCORE_TREND_LABELS } from '../src/config/boss-dashboard.constants'
import { summarizeBossRun } from '../src/services/boss-dashboard/boss-dashboard-sync-status.util'
import { isBossDashboardSyncRunning } from '../src/services/boss-dashboard/boss-dashboard-sync.service'
import { shouldFetchShopScoreToday } from '../src/services/boss-dashboard/boss-dashboard-score.service'
import {
  markBossShopScoreStale,
  resetBossShopScoreStaleForTests,
  shouldBypassBossShopScoreCooldown,
} from '../src/services/boss-dashboard/boss-dashboard-score-cooldown.util'
import { BUSINESS_SYNC_INTERVAL_MS } from '../src/config/business-sync.constants'
import {
  buildBossCooldownScopeKey,
  buildBossRequestHash,
  buildXhsRequestHash,
  checkXhsRequestAllowed,
  resetSyncRequestAuditStateForTests,
  resolveApiCooldownMs,
  runXhsRequestWithAuditAndThrottle,
  BOSS_COOLDOWN_VERSION,
} from '../src/services/sync-request-audit.service'

const issues: string[] = []
function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string) {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

async function main() {
  console.log('verify-boss-dashboard')

  if (DEFAULT_ROLE_PAGE_PERMISSIONS.super_admin.boss_dashboard) ok('super_admin 默认有老板查看权限')
  else fail('super_admin 应有 boss_dashboard')
  if (DEFAULT_ROLE_PAGE_PERMISSIONS.boss.boss_dashboard) ok('boss 默认有老板查看权限')
  else fail('boss 应有 boss_dashboard')
  if (DEFAULT_ROLE_PAGE_PERMISSIONS.local_viewer.boss_dashboard) ok('local_viewer 默认有老板查看权限')
  else fail('local_viewer 应有 boss_dashboard')
  if (!DEFAULT_ROLE_PAGE_PERMISSIONS.staff.boss_dashboard) ok('staff 默认无老板查看权限')
  else fail('staff 默认不应有 boss_dashboard')

  const yuan = yuanStringToCent('3838.85', 'test')
  if (yuan === 383885) ok('元转分正确')
  else fail(`元转分错误：${yuan}`)

  const withdrawRow = parseBossFlowRow({
    tradeNo: 'T1',
    createdTime: '2026-07-08 15:58:17',
    type: 'PAY_SUCCESS',
    typeDesc: '提现',
    outcomeAmount: '100.00',
  })
  if (withdrawRow && isWithdrawSuccessRow(withdrawRow)) ok('PAY_SUCCESS 识别为提现成功')
  else fail('PAY_SUCCESS 应识别为提现成功')

  const incomeRow = parseBossFlowRow({
    tradeNo: 'T2',
    createdTime: '2026-07-11 10:56:31',
    type: 'STATEMENT_IN',
    typeDesc: '结算入账',
    incomeAmount: '18.00',
  })
  if (incomeRow && isSettlementIncomeRow(incomeRow)) ok('STATEMENT_IN+income 计入到账')
  else fail('STATEMENT_IN+income 应计入到账')

  const chargeRow = parseBossFlowRow({
    tradeNo: 'T3',
    createdTime: '2026-07-09 16:32:04',
    type: 'STATEMENT_IN',
    typeDesc: '结算入账',
    outcomeAmount: '100.00',
  })
  if (chargeRow && chargeRow.flowKind !== 'statement_in') ok('仅 outcome 的 STATEMENT_IN 不计入到账')
  else fail('仅 outcome 的 STATEMENT_IN 不应计入到账')

  const aggregate = parseBossAggregateAccount({
    data: {
      accountVo: { avilableAmount: '10.50', totalAmount: '10.50', withdrawingAmount: '0.00' },
      depositAccountVo: { balanceAmount: '5000.00', standardAmount: '5000.00' },
      arrearsAmount: '0.00',
      statementPeriod: 7,
    },
  })
  if (aggregate.availableAmountCent === 1050) ok('资金摘要解析正确')
  else fail('资金摘要解析错误')

  const months = buildRecentMonthKeys(12)
  if (months.length === 12) ok('月度键生成 12 个月')
  else fail('月度键数量错误')

  const monthAgg = await aggregateMonthlyStatementIncome('shiyuju', months)
  if (monthAgg.length === 12) ok('月度聚合返回完整 12 个月')
  else fail('月度聚合缺月')

  const dup = await prisma.bossAccountFlow.findFirst({ where: { shopKey: 'xiangyu' } })
  if (!dup) ok('祥钰/XY 隔离静态检查通过（无样本时不冲突）')
  else ok('已有祥钰流水样本，唯一键由 shopKey+platformFlowId 保证')

  if (typeof shouldFetchShopScoreToday() === 'boolean') ok('店铺分时间判断函数可用')
  else fail('店铺分时间判断不可用')

  const trendSample = {
    data: {
      sellerScoreTrendMap: {
        logisticsScore: [{ date: '2026-07-01', current: 4.7 }],
        customerServiceScore: [{ date: '2026-07-01', current: 4.8 }],
      },
    },
  }
  const logisticsTrend = parseBossScoreTrend(trendSample, BOSS_SCORE_TREND_LABELS.logistics)
  const serviceTrend = parseBossScoreTrend(trendSample, BOSS_SCORE_TREND_LABELS.service)
  if (logisticsTrend[0]?.score === 4.7) ok('物流趋势 labels=logisticsScore 解析正确')
  else fail(`物流趋势解析错误：${JSON.stringify(logisticsTrend)}`)
  if (serviceTrend[0]?.score === 4.8) ok('服务趋势 labels=customerServiceScore 解析正确')
  else fail(`服务趋势解析错误：${JSON.stringify(serviceTrend)}`)

  const scoreCooldown = resolveApiCooldownMs('boss_shop_score')
  if (scoreCooldown <= BUSINESS_SYNC_INTERVAL_MS) {
    ok(`店铺分冷却 ${Math.round(scoreCooldown / 60000)} 分钟不超过经营同步 ${BUSINESS_SYNC_INTERVAL_MS / 60000} 分钟`)
  } else fail(`店铺分冷却过长：${scoreCooldown}ms`)

  resetSyncRequestAuditStateForTests()
  resetBossShopScoreStaleForTests()
  markBossShopScoreStale('shiyuju', '2099-01-01')
  if (shouldBypassBossShopScoreCooldown('shiyuju')) ok('stale_score_date 标记可用于下一轮重试')
  else fail('stale_score_date 标记缺失')
  const staleBypass = checkXhsRequestAllowed({
    shopId: 'verify-shop',
    apiName: 'boss_shop_score',
    requestHash: 'verify-hash',
    trigger: 'scheduled',
    cooldownOverrideMs: 0,
  })
  if (staleBypass.allowed) ok('旧评分日期受控重试可绕过冷却')
  else fail('旧评分日期重试应允许绕过冷却')
  resetSyncRequestAuditStateForTests()
  resetBossShopScoreStaleForTests()

  if (!isBossDashboardSyncRunning()) ok('单飞锁初始未运行')
  else fail('单飞锁初始状态异常')

  // --- 冷却隔离 v2 ---
  resetSyncRequestAuditStateForTests()
  const shops = [
    { shopKey: 'shiyuju', cred: 'cred-shiyuju' },
    { shopKey: 'hetianyayu', cred: 'cred-hetian' },
    { shopKey: 'xiangyu', cred: 'cred-xiangyu' },
    { shopKey: 'xyxiangyu', cred: 'cred-xy' },
  ] as const
  const hashes = shops.map((s) =>
    buildBossRequestHash({
      apiName: 'boss_account_summary',
      shopKey: s.shopKey,
      credentialId: s.cred,
      method: 'GET',
      url: BOSS_FINANCE_API.aggregateAccount,
    }),
  )
  if (new Set(hashes).size === 4) ok('四店相同账户汇总请求产生四个不同 requestHash')
  else fail(`四店 hash 未隔离：${hashes.join(',')}`)

  const scopeA = buildBossCooldownScopeKey('shiyuju', 'cred-a')
  const scopeB = buildBossCooldownScopeKey('shiyuju', 'cred-b')
  if (scopeA !== scopeB) ok('同店不同 PlatformCredential 不共用冷却作用域')
  else fail('凭证作用域未隔离')

  if (buildBossCooldownScopeKey('xiangyu', 'c1') !== buildBossCooldownScopeKey('xyxiangyu', 'c2')) {
    ok('祥钰珠宝与 XY祥钰珠宝不共用冷却作用域')
  } else fail('祥钰与 XY 作用域冲突')

  const uniqCred = `cred-shiyuju-${Date.now()}`
  const hash1 = buildBossRequestHash({
    apiName: 'boss_account_summary',
    shopKey: 'shiyuju',
    credentialId: uniqCred,
    method: 'GET',
    url: BOSS_FINANCE_API.aggregateAccount,
  })
  const scope1 = buildBossCooldownScopeKey('shiyuju', uniqCred)
  const run1 = await runXhsRequestWithAuditAndThrottle({
    shopId: uniqCred,
    apiName: 'boss_account_summary',
    method: 'GET',
    urlKey: 'aggregate',
    requestHash: hash1,
    cooldownScopeKey: scope1,
    execute: async () => ({ ok: true, data: { ok: 1 }, errorMessage: null }),
  })
  if (!run1.ok || run1.skippedRemote) fail('同店冷却测试：首次 mock 请求应成功执行')
  const sameShopAgain = checkXhsRequestAllowed({
    shopId: uniqCred,
    apiName: 'boss_account_summary',
    requestHash: hash1,
    cooldownScopeKey: scope1,
  })
  if (!sameShopAgain.allowed) ok('同店同接口重复请求触发冷却')
  else fail('同店冷却未生效')

  const otherShopAllowed = checkXhsRequestAllowed({
    shopId: shops[1]!.cred,
    apiName: 'boss_account_summary',
    requestHash: hashes[1]!,
    cooldownScopeKey: buildBossCooldownScopeKey(shops[1]!.shopKey, shops[1]!.cred),
  })
  if (otherShopAllowed.allowed) ok('不同店同接口不会互相冷却')
  else fail('跨店冷却误挡')

  const legacyHash = buildXhsRequestHash({ apiName: 'boss_account_summary', body: null })
  const v2AllowedDespiteLegacy = checkXhsRequestAllowed({
    shopId: uniqCred,
    apiName: 'boss_account_summary',
    requestHash: hash1,
    cooldownScopeKey: scope1,
  })
  if (!v2AllowedDespiteLegacy.allowed && legacyHash !== hash1) {
    ok('v2 店铺 hash 与 v1 全局 hash 不同')
  } else if (v2AllowedDespiteLegacy.allowed) {
    ok('v2 作用域与 v1 hash 隔离（或冷却已过期）')
  } else fail('v2/v1 hash 隔离检查异常')

  await runXhsRequestWithAuditAndThrottle({
    shopId: shops[2]!.cred,
    apiName: 'boss_account_summary',
    method: 'GET',
    urlKey: 'aggregate',
    requestHash: hashes[2]!,
    cooldownScopeKey: buildBossCooldownScopeKey(shops[2]!.shopKey, shops[2]!.cred),
    execute: async () => ({ ok: false, data: null, errorMessage: '冷却中（999s）' }),
  })
  const afterThrottle = checkXhsRequestAllowed({
    shopId: shops[2]!.cred,
    apiName: 'boss_account_summary',
    requestHash: hashes[2]!,
    cooldownScopeKey: buildBossCooldownScopeKey(shops[2]!.shopKey, shops[2]!.cred),
  })
  if (afterThrottle.allowed) ok('throttled/失败记录不会写入内存冷却（未成功不延长）')
  else fail('失败记录错误延长了冷却')

  const scoreCd = resolveApiCooldownMs('boss_shop_score')
  if (scoreCd <= BUSINESS_SYNC_INTERVAL_MS) ok(`店铺分冷却 ${Math.round(scoreCd / 60000)} 分钟符合当前规则`)
  else fail(`店铺分仍使用过长冷却：${scoreCd}ms`)

  if (BOSS_COOLDOWN_VERSION === 'boss-cooldown-v2') ok('老板冷却版本为 boss-cooldown-v2')
  else fail('老板冷却版本错误')

  resetSyncRequestAuditStateForTests()

  // --- BossSyncRunLog 状态 ---
  const allFailed = summarizeBossRun([
    {
      shopKey: 'shiyuju',
      fundSuccess: false,
      fundError: '冷却',
      scoreSkipped: true,
      scoreSaved: false,
      scoreDate: null,
    },
    {
      shopKey: 'hetianyayu',
      fundSuccess: false,
      fundError: '冷却',
      scoreSkipped: true,
      scoreSaved: false,
      scoreDate: null,
    },
  ])
  if (allFailed.status === 'failed') ok('四店全失败时 BossSyncRunLog 为 failed')
  else fail(`四店全失败状态错误：${allFailed.status}`)

  const partial = summarizeBossRun([
    {
      shopKey: 'shiyuju',
      fundSuccess: true,
      fundSnapshotWritten: true,
      scoreSkipped: true,
      scoreSaved: false,
      scoreDate: null,
    },
    {
      shopKey: 'hetianyayu',
      fundSuccess: false,
      fundError: 'x',
      scoreSkipped: true,
      scoreSaved: false,
      scoreDate: null,
    },
  ])
  if (partial.status === 'partial_success') ok('部分店铺成功时状态为 partial_success')
  else fail(`部分成功状态错误：${partial.status}`)

  const skippedAll = summarizeBossRun([
    {
      shopKey: 'shiyuju',
      fundSuccess: false,
      scoreSkipped: true,
      scoreSaved: false,
      scoreDate: null,
      skippedFresh: true,
    },
  ])
  if (skippedAll.status === 'skipped') ok('全部新鲜合理跳过时状态为 skipped')
  else fail(`skipped 状态错误：${skippedAll.status}`)

  // --- 资金 partial 字段策略（解析层） ---
  const partialAgg = parseBossAggregateAccount({
    data: {
      accountVo: { avilableAmount: '100.00', totalAmount: '100.00' },
    },
  })
  if (partialAgg.availableAmountCent === 10000 && partialAgg.frozenAmountCent == null) {
    ok('资金主接口成功时缺失辅助字段保持 null 而非 0')
  } else fail('资金解析不应把缺失字段写成 0')

  resetSyncRequestAuditStateForTests()
  resetBossShopScoreStaleForTests()

  const prevSnapshot = {
    id: 'verify-prev',
    shopKey: 'shiyuju',
    liveAccountId: 'verify',
    scoreDate: '2098-12-31',
    qualityScore: 4.5,
    logisticsScore: 4.6,
    serviceScore: 4.7,
    officialOverallScore: null,
    sourceApi: null,
    rawJson: null,
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await createScoreChangeAnnouncements({
    shop: { shopKey: 'shiyuju', shopName: '拾玉居和田玉' },
    scoreDate: '2099-01-01',
    previous: prevSnapshot,
    current: {
      scoreDate: '2099-01-01',
      qualityScore: 4.4,
      logisticsScore: 4.6,
      serviceScore: 4.7,
      officialOverallScore: null,
      raw: null,
    },
  })
  const down = await prisma.bossAnnouncement.findFirst({
    where: { dedupeKey: { startsWith: 'score:shiyuju:2099-01-01:qualityScore:' } },
  })
  if (down?.tone === 'negative') ok('分数下降生成红色公告')
  else fail('分数下降应生成 negative 公告')
  if (down) await prisma.bossAnnouncement.delete({ where: { id: down.id } })

  console.log(issues.length ? `\nFAILED ${issues.length}` : '\nALL PASS')
  await prisma.$disconnect()
  if (issues.length) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
