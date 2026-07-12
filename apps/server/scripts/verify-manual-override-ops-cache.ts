/**
 * 手动指定主播 + 运营报表缓存一致性只读验收
 *
 * npm run verify:manual-override-ops-cache
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { resolveAnchorWithScheduleOverlay } from '../src/services/anchor-schedule-attribution.service'
import {
  ensureManualAnchorOverrideCache,
  resolveManualAnchorOverrideForView,
  type ManualAnchorOverrideEntry,
} from '../src/services/order-anchor-manual-override.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { aggregateQualityRefundByAnchor } from '../src/services/quality-refund-anchor-attribution.service'
import { viewCountsAsQualityRefund } from '../src/services/quality-refund-resolution.service'
import { buildDailyOperationsReport } from '../src/services/daily-operations-report.service'
import {
  getLocalViewerCacheIdentity,
  getOperationsReportCache,
  getOrBuildOperationsReportCache,
  invalidateOperationsReportCache,
  listOperationsReportCacheKeys,
  prewarmOperationsReportCache,
} from '../src/services/operations-report-cache.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import type { AnalyzedOrderView } from '../src/types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`)
  process.exit(1)
}

function findViewByOrderKey(
  views: AnalyzedOrderView[],
  orderKey: string,
): AnalyzedOrderView | null {
  const keys = new Set([orderKey, orderKey.replace(/^P/, ''), `P${orderKey.replace(/^P/, '')}`])
  for (const view of views) {
    const orderNo = resolveMetricOrderNo(view)
    if (orderNo && keys.has(orderNo)) return view
    const bare = orderNo?.replace(/^P/, '')
    if (bare && keys.has(bare)) return view
    if (view.orderId && keys.has(view.orderId)) return view
    if (view.matchOrderId && keys.has(view.matchOrderId)) return view
  }
  return null
}

async function verifyManualOverrideAttribution(
  override: ManualAnchorOverrideEntry & { orderKey: string },
): Promise<void> {
  console.log('\n=== 1. 手动指定订单归属 ===')
  console.log(`orderKey=${override.orderKey} anchor=${override.anchorName}`)

  await ensureManualAnchorOverrideCache()

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) fail('无法加载分析包')
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map(
    (artifacts.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )
  const viewRaw = findViewByOrderKey(artifacts.views, override.orderKey)
  if (!viewRaw) fail(`未找到订单 ${override.orderKey} 的经营视图`)

  const view = attachRawByMatchToViews([viewRaw], rawByMatch)[0] as AnalyzedOrderView & {
    raw?: Record<string, unknown>
  }

  const resolved = await resolveAnchorWithScheduleOverlay(view)
  if (resolved.attributionSource !== 'manual_override') {
    fail(
      `resolveAnchorWithScheduleOverlay 来源应为 manual_override，实际 ${resolved.attributionSource}`,
    )
  }
  if (resolved.anchorName !== override.anchorName) {
    fail(
      `手动指定 ${override.anchorName}，resolve 得到 ${resolved.anchorName} (${resolved.attributionSource})`,
    )
  }
  ok(`resolveAnchorWithScheduleOverlay → ${resolved.anchorName} (${resolved.attributionSource})`)

  const liveSessions = bundle.liveSessions ?? []
  const coreViews = artifacts.views.filter((v) => {
    const orderNo = resolveMetricOrderNo(v)
    return orderNo === override.orderKey || orderNo?.replace(/^P/, '') === override.orderKey.replace(/^P/, '')
  })
  const withRaw = attachRawByMatchToViews(coreViews.length > 0 ? coreViews : [viewRaw], rawByMatch)
  const qrAgg = await aggregateQualityRefundByAnchor({ views: withRaw, liveSessions })
  const qrHit = qrAgg.attributions.find(
    (a) =>
      a.orderNo === override.orderKey ||
      a.orderNo?.replace(/^P/, '') === override.orderKey.replace(/^P/, ''),
  )
  if (qrHit && viewCountsAsQualityRefund(viewRaw)) {
    if (qrHit.attributionType !== 'manual_override' || qrHit.anchorName !== override.anchorName) {
      fail(
        `品退归属应为 manual_override/${override.anchorName}，实际 ${qrHit.attributionType}/${qrHit.anchorName}`,
      )
    }
    ok(`aggregateQualityRefundByAnchor → ${qrHit.anchorName} (${qrHit.attributionType})`)
  } else if (viewCountsAsQualityRefund(viewRaw)) {
    fail('品退订单未出现在 aggregateQualityRefundByAnchor 结果中')
  } else {
    ok('该订单非品退单，跳过品退归属校验')
  }

  // 轻量：内存 map 模拟清除手动指定后恢复自动归属查找
  const orderKey = resolveMetricOrderNo(view) || override.orderKey
  const withOverride = new Map<string, ManualAnchorOverrideEntry>([
    [orderKey, { anchorId: override.anchorId, anchorName: override.anchorName }],
  ])
  const hitWith = resolveManualAnchorOverrideForView(view, withOverride)
  if (!hitWith || hitWith.anchorName !== override.anchorName) {
    fail('内存 override map 应命中手动指定')
  }
  ok('内存 override map 命中手动指定')
  const hitCleared = resolveManualAnchorOverrideForView(view, new Map())
  if (hitCleared) {
    fail('清除手动指定后 resolveManualAnchorOverrideForView 应返回 null')
  }
  ok('清除手动指定后恢复自动归属查找（override map 为空）')
}

async function verifyOperationsReportCacheInvalidation(): Promise<void> {
  console.log('\n=== 2. 运营报表缓存失效 ===')
  const identity = getLocalViewerCacheIdentity()
  const today = formatDateKeyShanghai(new Date())

  invalidateOperationsReportCache('验收初始化')

  const dailyKey = {
    kind: 'daily' as const,
    startDate: today,
    endDate: today,
    preset: 'custom',
    scope: 'daily',
    ...identity,
  }

  const first = await getOrBuildOperationsReportCache(dailyKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: today,
      endDate: today,
      role: identity.role,
      username: identity.username,
    }),
  )
  const oldBuiltAt = first.cache.builtAt
  if (!oldBuiltAt) fail('首次构建未写入 builtAt')

  const cachedBefore = getOperationsReportCache(dailyKey)
  if (!cachedBefore) fail('首次构建后缓存应存在')

  invalidateOperationsReportCache('模拟手动指定后清空')
  if (listOperationsReportCacheKeys().length > 0) {
    fail('invalidateOperationsReportCache 后仍有残留 key')
  }
  if (getOperationsReportCache(dailyKey)) {
    fail('invalidateOperationsReportCache 后 daily 缓存仍可读')
  }
  ok('invalidateOperationsReportCache 已清空 daily/weekly/monthly/rankings 全部内存缓存')

  const second = await getOrBuildOperationsReportCache(
    dailyKey,
    () =>
      buildDailyOperationsReport({
        preset: 'custom',
        startDate: today,
        endDate: today,
        role: identity.role,
        username: identity.username,
      }),
    { forceRebuild: true },
  )
  const newBuiltAt = second.cache.builtAt
  if (!newBuiltAt || Date.parse(newBuiltAt) <= Date.parse(oldBuiltAt)) {
    fail(`forceRebuild 后 builtAt 未更新：old=${oldBuiltAt} new=${newBuiltAt ?? 'null'}`)
  }
  ok(`forceRebuild 后 builtAt 已更新：${oldBuiltAt} → ${newBuiltAt}`)

  invalidateOperationsReportCache('验收 prewarm 前清空')
  await prewarmOperationsReportCache('验收经营重建后 prewarm', { forceRebuild: true })
  const keysAfterPrewarm = listOperationsReportCacheKeys()
  const kinds = new Set(keysAfterPrewarm.map((k) => k.split('|')[0]))
  for (const kind of ['daily', 'weekly', 'monthly', 'rankings'] as const) {
    if (!kinds.has(kind)) {
      fail(`prewarm forceRebuild 后缺少 ${kind} 缓存`)
    }
  }
  ok(`prewarm forceRebuild 覆盖四类报表：${[...kinds].join(', ')}`)
}

async function main(): Promise<void> {
  console.log('verify-manual-override-ops-cache')
  await bootstrapQualityBadCaseCache()

  const overrideRow = await prisma.orderAnchorManualOverride.findFirst({
    orderBy: { updatedAt: 'desc' },
  })
  if (!overrideRow) {
    console.log('\n⚠ 数据库暂无 OrderAnchorManualOverride，跳过手动指定归属断言')
  } else {
    await verifyManualOverrideAttribution({
      orderKey: overrideRow.orderKey,
      anchorId: overrideRow.anchorId ?? '',
      anchorName: overrideRow.anchorName,
    })
  }

  await verifyOperationsReportCacheInvalidation()

  console.log('\n=== 结果 ===')
  console.log('PASS')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
