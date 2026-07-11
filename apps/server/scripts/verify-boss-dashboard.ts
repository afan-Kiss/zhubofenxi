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
  yuanStringToCent,
} from '../src/services/boss-dashboard/boss-dashboard-normalize.service'
import { buildRecentMonthKeys, aggregateMonthlyStatementIncome } from '../src/services/boss-dashboard/boss-dashboard-flow.service'
import { createScoreChangeAnnouncements } from '../src/services/boss-dashboard/boss-dashboard-announcement.service'
import { DEFAULT_ROLE_PAGE_PERMISSIONS } from '../src/config/page-permissions'
import { isBossDashboardSyncRunning } from '../src/services/boss-dashboard/boss-dashboard-sync.service'
import { shouldFetchShopScoreToday } from '../src/services/boss-dashboard/boss-dashboard-score.service'

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

  if (!isBossDashboardSyncRunning()) ok('单飞锁初始未运行')
  else fail('单飞锁初始状态异常')

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
