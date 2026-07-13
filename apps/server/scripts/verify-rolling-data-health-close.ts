/**
 * 滚动 30 天数据健康结账验收
 *
 * npm run verify:rolling-data-health-close
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import {
  resolveRollingDataHealthCloseRange,
  buildRollingDataHealthCloseReport,
} from '../src/services/rolling-data-health-close.service'
import { addDaysShanghai } from '../src/utils/business-timezone'
import {
  isNoAfterSaleText,
  isPositiveAfterSaleText,
  viewHasAfterSaleStatusSignal,
} from '../src/services/after-sale-status-signal.service'
import { isActualAfterSaleOrder } from '../src/services/operations-after-sale-order.util'
import {
  calculateBusinessMetrics,
  viewInvolvesRefundAfterSale,
} from '../src/services/business-metrics.service'
import {
  resolveViewRefundAmountCent,
  viewCountsAsRefundOrder,
} from '../src/services/order-refund-metrics.service'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

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

async function main(): Promise<void> {
  console.log('verify-rolling-data-health-close\n')

  const service = read('server/src/services/rolling-data-health-close.service.ts')
  const store = read('server/src/services/rolling-data-health-close-store.service.ts')
  const scheduler = read('server/src/services/scheduler.service.ts')
  const syncMeta = read('server/src/services/board-sync-meta.service.ts')
  const routes = read('server/src/routes/board.routes.ts')
  const panel = read('web/src/components/board/DataHealthPanel.tsx')

  const sample = resolveRollingDataHealthCloseRange('2026-07-06')
  const expectedEnd = addDaysShanghai('2026-07-06', -15)
  const expectedStart = addDaysShanghai(expectedEnd, -29)

  if (sample.endDate === expectedEnd) {
    ok(`endDate = 当前上海日期 - 15 天 (${sample.endDate})`)
  } else {
    fail(`endDate 期望 ${expectedEnd}，实际 ${sample.endDate}`)
  }

  if (sample.startDate === expectedStart) {
    ok(`startDate = endDate - 29 天 (${sample.startDate})`)
  } else {
    fail(`startDate 期望 ${expectedStart}，实际 ${sample.startDate}`)
  }

  if (sample.dayCount === 30) {
    ok('范围刚好 30 天')
  } else {
    fail(`范围天数应为 30，实际 ${sample.dayCount}`)
  }

  if (!service.includes('resolveMonthlyCloseMonth') && !service.includes('resolveAutoCloseTargetMonth')) {
    ok('滚动结账未使用自然月 resolveMonthlyCloseMonth / resolveAutoCloseTargetMonth')
  } else {
    fail('滚动结账误用自然月范围函数')
  }

  if (service.includes('calculateBusinessMetrics')) {
    ok('runRollingDataHealthClose 使用 calculateBusinessMetrics')
  } else {
    fail('未使用 calculateBusinessMetrics')
  }

  if (
    routes.includes('sendOk(res, { ok: true, report })') &&
    !routes.includes('refundOrderCount: report.refundOrderCount')
  ) {
    ok('POST /run 返回完整 report 对象')
  } else {
    fail('POST /run 未返回完整 report')
  }

  if (store.includes('acquireRollingDataHealthCloseLock')) {
    ok('存在 acquireRollingDataHealthCloseLock')
  } else {
    fail('缺少 acquireRollingDataHealthCloseLock')
  }

  if (store.includes('rolling-data-health-close.lock') && !store.includes('monthly-close-auto.lock')) {
    ok('lock 文件为 rolling-data-health-close.lock')
  } else {
    fail('lock 文件名不正确')
  }

  if (service.includes('acquireRollingDataHealthCloseLock')) {
    ok('runRollingDataHealthClose 使用 acquireRollingDataHealthCloseLock')
  } else {
    fail('runRollingDataHealthClose 未使用锁')
  }

  if (service.includes('finally') && service.includes('releaseLock')) {
    ok('runRollingDataHealthClose finally 释放锁')
  } else {
    fail('runRollingDataHealthClose 未在 finally 释放锁')
  }

  if (store.includes('afterSaleCacheRecordCount') && store.includes('afterSaleCacheRecordScope')) {
    ok('report 类型包含 afterSaleCacheRecordCount / afterSaleCacheRecordScope')
  } else {
    fail('report 缺少售后缓存字段')
  }

  if (service.includes('售后相关订单可能偏低') && service.includes('售后缓存记录可能未同步')) {
    ok('warning 区分售后相关订单和售后缓存记录')
  } else {
    fail('warning 未区分售后相关订单和售后缓存记录')
  }

  const businessMetrics = read('server/src/services/business-metrics.service.ts')
  const signalService = read('server/src/services/after-sale-status-signal.service.ts')
  const operationsAfterSale = read('server/src/services/operations-after-sale-order.util.ts')
  const validRevenue = read('server/src/services/valid-revenue-order.service.ts')
  const metricDetail = read('server/src/services/board-metric-detail.service.ts')
  const orderMetricSets = read('server/src/services/order-metric-sets.service.ts')
  const monthlyClose = read('server/src/services/monthly-close-reconciliation.service.ts')

  if (signalService.includes('isNoAfterSaleText') && signalService.includes('isPositiveAfterSaleText')) {
    ok('after-sale-status-signal 存在公共售后判断')
  } else {
    fail('after-sale-status-signal 缺少公共售后判断')
  }

  if (businessMetrics.includes('after-sale-status-signal.service')) {
    ok('business-metrics 复用 after-sale-status-signal')
  } else {
    fail('business-metrics 未复用公共售后工具')
  }

  if (
    operationsAfterSale.includes('isNoAfterSaleText') &&
    operationsAfterSale.includes('isOperationalAfterSaleText') &&
    !operationsAfterSale.includes('isActualRefundAfterSaleText') &&
    !operationsAfterSale.includes('/售后|退款|退货/')
  ) {
    ok('operations-after-sale 复用公共工具且无裸匹配')
  } else {
    fail('operations-after-sale 未复用公共工具或仍裸匹配')
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
    ok('METRICS_ORDER_DEDUPE 含退款类指标')
  } else {
    fail('METRICS_ORDER_DEDUPE 未含 returnAmount/returnCount/returnRate')
  }

  if (orderMetricSets.includes('afterSaleRelatedOrderCount') && orderMetricSets.includes('dedupeOrderCountByOrderNo')) {
    ok('order-metric-sets 存在 afterSaleRelatedOrderCount 且按 P 单号去重')
  } else {
    fail('order-metric-sets 缺少 afterSaleRelatedOrderCount 去重')
  }

  const viewInvolvesBlock = businessMetrics.slice(
    businessMetrics.indexOf('function viewInvolvesRefundAfterSale'),
    businessMetrics.indexOf('function viewInvolvesRefundAfterSale') + 220,
  )
  if (viewInvolvesBlock.includes('isFreightRefundOnly')) {
    ok('viewInvolvesRefundAfterSale 排除 isFreightRefundOnly')
  } else {
    fail('viewInvolvesRefundAfterSale 未排除 isFreightRefundOnly')
  }

  if (
    store.includes('afterSaleRelatedOrderCount') &&
    store.includes('afterSaleSignalRecordCount') &&
    service.includes('afterSaleSignalRecordCount')
  ) {
    ok('rolling report 包含 afterSaleRelatedOrderCount / afterSaleSignalRecordCount')
  } else {
    fail('rolling report 缺少售后相关订单/信号记录字段')
  }

  if (store.includes('ROLLING_DATA_HEALTH_CLOSE_LOCK_STALE_MS') && store.includes('clearExpiredRollingCloseLockIfNeeded')) {
    ok('lock 存在 ROLLING_DATA_HEALTH_CLOSE_LOCK_STALE_MS 且过期会清理')
  } else {
    fail('lock 缺少过期自动清理')
  }

  if (store.includes('发现过期滚动结账锁，已自动清理')) {
    ok('过期锁清理会 logWarn')
  } else {
    fail('过期锁清理缺少 logWarn')
  }

  if (monthlyClose.includes('isUnassignedMonthlyCloseView') && monthlyClose.includes("name === '未归属'")) {
    ok('monthly-close 使用 isUnassignedMonthlyCloseView（含 anchorName=未归属）')
  } else {
    fail('monthly-close 未统一未归属判断')
  }

  if (
    !monthlyClose.match(/filter\(\(v\) => v\.attributionType === 'unassigned'\)/) &&
    !monthlyClose.match(/filter\(\s*\(v\)\s*=>\s*v\.attributionType === 'unassigned'\s*,\s*\)/)
  ) {
    ok('monthly-close 不再仅用 attributionType=unassigned 过滤')
  } else {
    fail('monthly-close 仍仅用 attributionType=unassigned')
  }

  if (panel.includes('售后信号记录') && panel.includes('全库累计')) {
    ok('DataHealthPanel 显示售后信号记录与全库累计')
  } else {
    fail('DataHealthPanel 缺少售后信号记录或全库累计')
  }

  if (service.includes('售后信号记录可能偏低')) {
    ok('warning 区分售后信号记录')
  } else {
    fail('warning 未区分售后信号记录')
  }

  for (const field of [
    'gmvAmountYuan',
    'actualSignedAmountYuan',
    'refundAmountYuan',
    'paidOrderCount',
    'signedOrderCount',
    'refundOrderCount',
    'signRate',
    'refundRate',
    'qualityRefundOrderCount',
  ]) {
    if (store.includes(field)) ok(`报告包含 ${field}`)
    else fail(`报告缺少 ${field}`)
  }

  if (
    scheduler.includes('function scheduleRollingDataHealthClose') &&
    scheduler.includes("triggeredBy: 'rolling-health-scheduler'")
  ) {
    ok('独立 cron 03:10 触发 runRollingDataHealthClose')
  } else {
    fail('scheduler 缺少独立 rolling-health-scheduler cron')
  }

  const buyerCron = scheduler.slice(
    scheduler.indexOf('function scheduleBuyerRankingCache'),
    scheduler.indexOf('function scheduleBuyerRankingCache') + 900,
  )
  if (!buyerCron.includes('runRollingDataHealthClose')) {
    ok('买家排行 cron 不再触发 runRollingDataHealthClose')
  } else {
    fail('买家排行 cron 仍触发 runRollingDataHealthClose')
  }

  if (scheduler.includes('scheduleRollingDataHealthCloseStartupCatchup')) {
    ok('启动时滚动数据健康补跑')
  } else {
    fail('scheduler 缺少启动补跑')
  }

  if (syncMeta.includes('rollingDataHealthClose')) {
    ok('board-sync-meta 返回 rollingDataHealthClose')
  } else {
    fail('board-sync-meta 未返回 rollingDataHealthClose')
  }

  if (panel.includes('滚动30天结账')) {
    ok('DataHealthPanel 显示「滚动30天结账」')
  } else {
    fail('DataHealthPanel 未显示滚动30天结账')
  }

  if (routes.includes('/data-health/rolling-close/run') && routes.includes('/data-health/rolling-close/latest')) {
    ok('手动触发与只读接口已注册')
  } else {
    fail('滚动结账 API 未注册')
  }

  const monthlyScheduler = read('server/src/services/monthly-close-scheduler.service.ts')
  if (monthlyScheduler.includes('runMonthlyCloseAuto')) {
    ok('保留老 monthly-close-scheduler 每月逻辑')
  } else {
    fail('monthly-close-scheduler 逻辑缺失')
  }

  const dataHealthPage = read('web/src/pages/board/DataHealthPage.tsx')
  const indexTs = read('server/src/index.ts')
  const roleMw = read('server/src/middleware/role.middleware.ts')

  if (dataHealthPage.includes('数据健康 / 滚动30天结账')) {
    ok('DataHealthPage 标题为滚动30天结账')
  } else {
    fail('DataHealthPage 标题未改为滚动30天结账')
  }

  if (
    !dataHealthPage.includes('每月 15') &&
    !dataHealthPage.includes('每月15') &&
    !dataHealthPage.includes('月度结账') &&
    !dataHealthPage.includes('本月结账')
  ) {
    ok('DataHealthPage 不再出现每月15日/月度结账旧文案')
  } else {
    fail('DataHealthPage 仍含每月15日或月度结账旧文案')
  }

  if (dataHealthPage.includes('/api/board/data-health/rolling-close/status')) {
    ok('DataHealthPage 主数据源为 rolling-close/status')
  } else {
    fail('DataHealthPage 未改用 rolling-close/status')
  }

  if (!dataHealthPage.includes('/api/board/monthly-close/status')) {
    ok('DataHealthPage 不再调用 monthly-close/status 作为主数据源')
  } else {
    fail('DataHealthPage 仍调用 monthly-close/status')
  }

  if (!dataHealthPage.includes('/api/board/monthly-close/rerun')) {
    ok('DataHealthPage 不再调用 monthly-close/rerun')
  } else {
    fail('DataHealthPage 仍调用 monthly-close/rerun')
  }

  if (dataHealthPage.includes('/api/board/data-health/rolling-close/run')) {
    ok('DataHealthPage 手动核对调用 rolling-close/run')
  } else {
    fail('DataHealthPage 未调用 rolling-close/run')
  }

  if (
    dataHealthPage.includes("user?.role === 'super_admin'") &&
    dataHealthPage.includes('立即重新核对滚动30天')
  ) {
    ok('仅 super_admin 可见手动核对按钮文案')
  } else {
    fail('手动核对按钮权限或文案不正确')
  }

  if (!dataHealthPage.includes('请联系管理员') && !dataHealthPage.includes('/维护|403|404|未启用|权限/')) {
    ok('DataHealthPage 不再粗暴映射为「请联系管理员」')
  } else {
    fail('DataHealthPage 仍含错误权限文案映射')
  }

  const loadStart = dataHealthPage.indexOf('const load = useCallback')
  const loadEnd = dataHealthPage.indexOf('}, [])', loadStart)
  const loadBlock = loadStart >= 0 && loadEnd > loadStart ? dataHealthPage.slice(loadStart, loadEnd) : ''
  if (loadBlock.includes('rolling-close/status') && !loadBlock.includes('rolling-close/run')) {
    ok('页面打开只读状态，load 不触发 POST run')
  } else {
    fail('页面打开可能自动触发 POST run，或 load 未隔离')
  }

  if (
    routes.includes("boardRouter.post('/data-health/rolling-close/run', requireSuperAdmin") &&
    !/rolling-close\/run',\s*requireMaintenanceTools/.test(routes)
  ) {
    ok('POST rolling-close/run 使用 requireSuperAdmin，不依赖维护开关')
  } else {
    fail('POST rolling-close/run 权限中间件不正确')
  }

  if (routes.includes("boardRouter.get('/data-health/rolling-close/status'")) {
    ok('存在 GET rolling-close/status')
  } else {
    fail('缺少 GET rolling-close/status')
  }

  if (routes.includes("'/monthly-close/rerun', requireSuperAdmin")) {
    ok('旧 monthly-close/rerun 已加 requireSuperAdmin')
  } else {
    fail('旧 monthly-close/rerun 缺少 requireSuperAdmin')
  }

  if (roleMw.includes('requireSuperAdmin') && roleMw.includes("requireRole('super_admin')")) {
    ok('存在 requireSuperAdmin 中间件')
  } else {
    fail('缺少 requireSuperAdmin 中间件')
  }

  if (!indexTs.includes('initMonthlyCloseScheduler') && scheduler.includes('initMonthlyCloseScheduler')) {
    ok('月度结账调度仅由 initScheduler 注册，index.ts 不再重复注册')
  } else {
    fail('月度结账调度仍可能在 index.ts 与 initScheduler 重复注册')
  }

  if (scheduler.includes('getRollingDataHealthCloseSchedulerInfo')) {
    ok('scheduler 导出滚动结账注册状态查询')
  } else {
    fail('scheduler 未导出滚动结账注册状态')
  }

  if (store.includes('readLastRollingDataHealthCloseRunLog')) {
    ok('store 可读取最近一次运行日志')
  } else {
    fail('store 缺少 readLastRollingDataHealthCloseRunLog')
  }

  const metricLabels = [
    '支付金额',
    '已签收金额',
    '支付订单数',
    '已签收订单数',
    '签收率',
    '退款金额',
    '退款订单数',
    '退款率',
    '品退订单数',
    '品退率',
    '售后相关订单数',
    '售后缓存记录数',
    '未归属订单数',
    '重复订单风险数',
  ]
  if (metricLabels.every((l) => dataHealthPage.includes(l))) {
    ok('页面展示滚动结账核心指标字段')
  } else {
    fail('页面缺少滚动结账核心指标字段')
  }

  if (
    dataHealthPage.includes('report.gmvAmountYuan') &&
    dataHealthPage.includes('report.actualSignedAmountYuan') &&
    dataHealthPage.includes('report.paidOrderCount')
  ) {
    ok('页面金额/单数直接绑定 latest 报告字段')
  } else {
    fail('页面未直接绑定 latest 报告金额/单数字段')
  }

  if (
    !signalService.includes("negWords.some((w) => raw.includes(w)) && raw.includes('售后')") &&
    signalService.includes('NO_AFTER_SALE_PHRASES')
  ) {
    ok('isNoAfterSaleText 使用明确负例短语，无宽泛 未+售后 规则')
  } else {
    fail('isNoAfterSaleText 仍含宽泛 未+售后 误判规则')
  }

  console.log('\n=== 售后信号运行时断言 ===')
  const negativeTexts = [
    '无售后',
    '暂无售后',
    '未申请售后',
    '未发起售后',
    '未产生售后',
    '没有售后',
    '售后状态：无',
    '售后：无',
    '退款状态：无',
    '退货状态：无',
    '无退款',
    '无退货',
  ]
  for (const text of negativeTexts) {
    if (isNoAfterSaleText(text)) {
      ok(`isNoAfterSaleText「${text}」`)
    } else {
      fail(`isNoAfterSaleText 未识别「${text}」`)
    }
    const view = { afterSaleStatusText: text } as AnalyzedOrderView
    if (!viewHasAfterSaleStatusSignal(view)) {
      ok(`「${text}」不算售后信号`)
    } else {
      fail(`「${text}」被误判为售后信号`)
    }
  }

  const operationsNegatives = ['暂无售后', '未申请售后', '未发起售后', '售后状态：无', '无售后']
  for (const text of operationsNegatives) {
    const view = { afterSaleStatusText: text } as AnalyzedOrderView
    if (!isActualAfterSaleOrder(view)) ok(`运营「${text}」不算售后相关`)
    else fail(`运营「${text}」被误判为售后相关`)
  }
  for (const text of [
    '售后申请',
    '售后中',
    '售后处理中',
    '售后申请未处理',
    '售后处理中未退款',
    '售后关闭',
    '关闭无退款',
    '售后完成未退款',
    '退款成功',
    '退货退款',
  ]) {
    const view = { afterSaleStatusText: text } as AnalyzedOrderView
    if (isActualAfterSaleOrder(view)) ok(`运营「${text}」算售后相关`)
    else fail(`运营「${text}」未识别为售后相关`)
  }

  const positiveTexts = [
    '售后完成未退款',
    '售后关闭未退款',
    '售后中未退款',
    '售后申请未处理',
    '售后处理中未退款',
    '退款成功',
    '退货退款',
    '仅退款',
    '售后完成',
  ]
  for (const text of positiveTexts) {
    if (!isNoAfterSaleText(text)) {
      ok(`isNoAfterSaleText 未误伤「${text}」`)
    } else {
      fail(`isNoAfterSaleText 误伤「${text}」`)
    }
    const view = { afterSaleStatusText: text } as AnalyzedOrderView
    if (viewHasAfterSaleStatusSignal(view)) {
      ok(`「${text}」算售后信号`)
    } else {
      fail(`「${text}」未识别为售后信号`)
    }
  }

  if (isPositiveAfterSaleText('售后完成未退款')) {
    ok('isPositiveAfterSaleText「售后完成未退款」')
  } else {
    fail('isPositiveAfterSaleText 未识别「售后完成未退款」')
  }

  console.log('\n=== 组合无售后文案运行时断言 ===')
  for (const text of [
    '无售后 无退款',
    '售后：无 退款状态：无',
    '售后状态：无 退货状态：无',
    '暂无售后 / 无退款',
  ]) {
    if (isNoAfterSaleText(text)) ok(`组合负例 isNoAfterSaleText「${text}」`)
    else fail(`组合负例 isNoAfterSaleText 未识别「${text}」`)
    if (!isPositiveAfterSaleText(text)) ok(`组合负例 isPositiveAfterSaleText false「${text}」`)
    else fail(`组合负例 isPositiveAfterSaleText 误判「${text}」`)
  }
  for (const text of ['无售后 退款成功', '售后：无 退货退款', '售后完成未退款']) {
    if (isPositiveAfterSaleText(text)) ok(`组合正例 isPositiveAfterSaleText「${text}」`)
    else fail(`组合正例 isPositiveAfterSaleText 未识别「${text}」`)
  }

  console.log('\n=== 纯运费补偿(18元)运行时断言 ===')
  const freightView = {
    packageId: 'PKG-FREIGHT-ROLLING-VERIFY',
    includedInGmv: true,
    paymentBaseCent: 50000,
    isFreightRefundOnly: true,
    freightRefundAmountCent: 1800,
    productRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    returnAmountCent: 1800,
    afterSaleStatusText: '退款成功',
    afterSaleDisplayType: '运费补偿',
    orderStatusText: '已完成',
    statusSigned: true,
    actualSignAmountCent: 50000,
  } as AnalyzedOrderView
  const realView = {
    packageId: 'PKG-REAL-AFTERSALE-ROLLING-VERIFY',
    includedInGmv: true,
    isFreightRefundOnly: false,
    productRefundAmountCent: 5000,
    realAfterSaleAmountCent: 5000,
    afterSaleStatusText: '退款成功',
  } as AnalyzedOrderView

  if (!viewInvolvesRefundAfterSale(freightView)) ok('纯运费 viewInvolvesRefundAfterSale=false')
  else fail('纯运费 viewInvolvesRefundAfterSale 误判')
  if (!viewCountsAsRefundOrder(freightView)) ok('纯运费 viewCountsAsRefundOrder=false')
  else fail('纯运费 viewCountsAsRefundOrder 误判')
  if (resolveViewRefundAmountCent(freightView) === 0) ok('纯运费 resolveViewRefundAmountCent=0')
  else fail('纯运费 resolveViewRefundAmountCent 非 0')
  if (!isActualAfterSaleOrder(freightView)) ok('纯运费 isActualAfterSaleOrder=false')
  else fail('纯运费 isActualAfterSaleOrder 误判')
  if (isEffectiveSignedView(freightView)) ok('纯运费 isEffectiveSignedView=true')
  else fail('纯运费 isEffectiveSignedView 误判')
  const freightMetrics = calculateBusinessMetrics([freightView])
  if (freightMetrics.refundAmount === 0 && freightMetrics.refundOrderCount === 0) {
    ok('纯运费 refundAmount/refundOrderCount=0')
  } else {
    fail(`纯运费 refundAmount=${freightMetrics.refundAmount} refundOrderCount=${freightMetrics.refundOrderCount}`)
  }
  if (freightMetrics.afterSaleRelatedOrderCount === 0) ok('纯运费 afterSaleRelatedOrderCount=0')
  else fail(`纯运费 afterSaleRelatedOrderCount=${freightMetrics.afterSaleRelatedOrderCount}`)
  if (freightMetrics.freightRefundAmount === 18) ok('纯运费 freightRefundAmount=18')
  else fail(`纯运费 freightRefundAmount=${freightMetrics.freightRefundAmount}`)
  if (freightMetrics.actualSignedAmount === 500) ok('纯运费 actualSignedAmount=500')
  else fail(`纯运费 actualSignedAmount=${freightMetrics.actualSignedAmount}`)

  if (viewInvolvesRefundAfterSale(realView)) ok('真实售后 viewInvolvesRefundAfterSale=true')
  else fail('真实售后 viewInvolvesRefundAfterSale 未识别')
  if (viewCountsAsRefundOrder(realView)) ok('真实售后 viewCountsAsRefundOrder=true')
  else fail('真实售后 viewCountsAsRefundOrder 未识别')
  if (resolveViewRefundAmountCent(realView) === 5000) ok('真实售后 resolveViewRefundAmountCent=5000')
  else fail(`真实售后 resolveViewRefundAmountCent=${resolveViewRefundAmountCent(realView)}`)

  console.log('\n=== 运行时冒烟 ===')
  try {
    const report = await buildRollingDataHealthCloseReport({ triggeredBy: 'verify-script' })
    ok(
      `buildRollingDataHealthCloseReport OK: ${report.startDate}~${report.endDate} GMV=${report.gmvAmountYuan}`,
    )
  } catch (err) {
    fail(`buildRollingDataHealthCloseReport 失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

void main()
