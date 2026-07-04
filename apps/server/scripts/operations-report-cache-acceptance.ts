/**
 * 运营报表成品缓存验收
 * 用法: npm run accept:operations-report-cache
 */
import { LOCAL_VIEWER_USER } from '../src/constants/local-viewer'
import { buildDailyOperationsReport } from '../src/services/daily-operations-report.service'
import { buildWeeklyOperationsReport } from '../src/services/weekly-operations-report.service'
import { getMonthlyOperationsReport } from '../src/services/monthly-operations-report.service'
import { getOperationsRankings } from '../src/services/operations-rankings.service'
import {
  buildOperationsReportCacheKey,
  getLocalViewerCacheIdentity,
  getOperationsReportCache,
  getOperationsReportCacheStatus,
  getOrBuildOperationsReportCache,
  invalidateOperationsReportCache,
  listOperationsReportCacheKeys,
  prewarmOperationsReportCache,
  resolveMonthlyCacheKeyInput,
  __testOnlyMarkCacheStale,
} from '../src/services/operations-report-cache.service'

const PRIVACY_FIELDS = [
  'phone',
  'mobile',
  'address',
  'receiver',
  'buyerName',
  'buyerPhone',
  'platformRawJson',
  'rawJson',
  'idCard',
  'buyerId',
  'buyerKey',
]

import { acceptanceFetch } from './operations-acceptance-auth'

const BASE = (process.env.METRICS_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4723').replace(
  /\/$/,
  '',
)

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function scanPrivacy(payload: unknown, issues: string[]) {
  const json = JSON.stringify(payload)
  for (const f of PRIVACY_FIELDS) {
    if (json.includes(`"${f}"`)) issues.push(`响应含隐私字段 ${f}`)
  }
}

async function main() {
  const issues: string[] = []
  invalidateOperationsReportCache('验收开始')

  const identity = getLocalViewerCacheIdentity()
  const dailyDate = '2026-05-28'
  const weekStart = '2026-05-26'
  const weekEnd = '2026-06-01'
  const month = '2026-05'

  const dailyKey = {
    kind: 'daily' as const,
    startDate: dailyDate,
    endDate: dailyDate,
    preset: 'custom',
    scope: 'daily',
    ...identity,
  }

  const weeklyKey = {
    kind: 'weekly' as const,
    startDate: weekStart,
    endDate: weekEnd,
    preset: 'custom',
    scope: 'weekly',
    ...identity,
  }

  const monthlyKey = resolveMonthlyCacheKeyInput({
    month,
    preset: 'custom',
    ...identity,
  })

  const rankingsKey = {
    kind: 'rankings' as const,
    startDate: weekStart,
    endDate: weekEnd,
    preset: 'custom',
    scope: 'custom',
    limit: 10,
    ...identity,
  }

  // 1-2 日报缓存
  const dailyFirst = await getOrBuildOperationsReportCache(dailyKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: dailyDate,
      endDate: dailyDate,
      ...identity,
    }),
  )
  assert(dailyFirst.cache.hit === false, '日报首次请求 hit 应为 false', issues)
  assert(getOperationsReportCache(dailyKey) != null, '日报首次请求应写入缓存', issues)

  const dailySecond = await getOrBuildOperationsReportCache(dailyKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: dailyDate,
      endDate: dailyDate,
      ...identity,
    }),
  )
  assert(dailySecond.cache.hit === true, '日报第二次请求应命中缓存', issues)
  assert(
    dailySecond.payload.summary.soldOrderCount === dailyFirst.payload.summary.soldOrderCount,
    '日报缓存命中不应改变 summary 订单数',
    issues,
  )

  // 3-4 周报缓存
  const weeklyFirst = await getOrBuildOperationsReportCache(weeklyKey, () =>
    buildWeeklyOperationsReport({ weekStart, weekEnd, preset: 'custom', ...identity }),
  )
  assert(weeklyFirst.cache.hit === false, '周报首次请求 hit 应为 false', issues)
  const weeklySecond = await getOrBuildOperationsReportCache(weeklyKey, () =>
    buildWeeklyOperationsReport({ weekStart, weekEnd, preset: 'custom', ...identity }),
  )
  assert(weeklySecond.cache.hit === true, '周报第二次请求应命中缓存', issues)

  // 5-6 月报缓存
  const monthlyFirst = await getOrBuildOperationsReportCache(monthlyKey, () =>
    getMonthlyOperationsReport({ month, preset: 'custom', ...identity }),
  )
  assert(monthlyFirst.cache.hit === false, '月报首次请求 hit 应为 false', issues)
  assert(
    Number.isFinite(monthlyFirst.payload.summary.validAmountYuan),
    '月报 validAmountYuan 应为有限数',
    issues,
  )
  const monthlySecond = await getOrBuildOperationsReportCache(monthlyKey, () =>
    getMonthlyOperationsReport({ month, preset: 'custom', ...identity }),
  )
  assert(monthlySecond.cache.hit === true, '月报第二次请求应命中缓存', issues)

  // 7 榜单缓存
  await getOrBuildOperationsReportCache(rankingsKey, () =>
    getOperationsRankings({
      startDate: weekStart,
      endDate: weekEnd,
      preset: 'custom',
      scope: 'custom',
      limit: 10,
      ...identity,
    }),
  )
  const rankingsSecond = await getOrBuildOperationsReportCache(rankingsKey, () =>
    getOperationsRankings({
      startDate: weekStart,
      endDate: weekEnd,
      preset: 'custom',
      scope: 'custom',
      limit: 10,
      ...identity,
    }),
  )
  assert(rankingsSecond.cache.hit === true, '榜单第二次请求应命中缓存', issues)

  // 9 过期缓存先返回旧数据并后台刷新
  await getOrBuildOperationsReportCache(dailyKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: dailyDate,
      endDate: dailyDate,
      ...identity,
    }),
  )
  __testOnlyMarkCacheStale(dailyKey)
  const staleResult = await getOrBuildOperationsReportCache(dailyKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: dailyDate,
      endDate: dailyDate,
      ...identity,
    }),
  )
  assert(staleResult.cache.hit === true, '过期缓存应先命中旧数据', issues)
  assert(staleResult.cache.stale === true, '过期缓存 stale 应为 true', issues)
  assert(staleResult.cache.refreshing === true, '过期缓存应标记 refreshing', issues)

  // 8 同 key 并发只构建一次
  invalidateOperationsReportCache('并发测试')
  let concurrentBuilds = 0
  const concurrentKey = { ...dailyKey, startDate: '2026-05-27', endDate: '2026-05-27' }
  const concurrentBuilder = async () => {
    concurrentBuilds += 1
    await new Promise((r) => setTimeout(r, 150))
    return buildDailyOperationsReport({
      preset: 'custom',
      startDate: '2026-05-27',
      endDate: '2026-05-27',
      ...identity,
    })
  }
  await Promise.all([
    getOrBuildOperationsReportCache(concurrentKey, concurrentBuilder),
    getOrBuildOperationsReportCache(concurrentKey, concurrentBuilder),
  ])
  assert(concurrentBuilds === 1, `同 key 并发应只构建 1 次，实际 ${concurrentBuilds}`, issues)

  // 10 经营建议 POST 后缓存失效（MVP 全量清空）
  assert(getOperationsReportCacheStatus().entryCount > 0, '失效前应有缓存条目', issues)
  invalidateOperationsReportCache('经营建议处理状态已更新')
  assert(getOperationsReportCacheStatus().entryCount === 0, '经营建议更新后应清空缓存', issues)

  // 11 手动预热
  const prewarmResult = await prewarmOperationsReportCache('验收脚本', { forceRebuild: true })
  assert(prewarmResult.warmed + prewarmResult.failed > 0, '手动预热应执行至少一项', issues)
  assert(getOperationsReportCacheStatus().entryCount > 0, '预热后应有缓存条目', issues)

  // 12 缓存状态接口（服务层）
  const status = getOperationsReportCacheStatus()
  assert(status.entryCount >= 0, '缓存状态 entryCount 应可用', issues)
  assert(typeof status.prewarmRunning === 'boolean', 'prewarmRunning 应为 boolean', issues)

  // 13 cacheMeta 不影响原 payload 字段
  assert(dailySecond.payload.startDate === dailyDate, 'cacheMeta 不应破坏 startDate', issues)
  assert(dailySecond.payload.summary != null, 'cacheMeta 不应破坏 summary', issues)

  // 14 不包含客户隐私字段
  scanPrivacy(dailySecond.payload, issues)
  scanPrivacy(weeklySecond.payload, issues)
  scanPrivacy(monthlySecond.payload, issues)
  scanPrivacy(rankingsSecond.payload, issues)

  // 15 构建失败但有旧缓存时返回旧缓存
  const failKey = { ...dailyKey, startDate: '2026-05-29', endDate: '2026-05-29' }
  await getOrBuildOperationsReportCache(failKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: '2026-05-29',
      endDate: '2026-05-29',
      ...identity,
    }),
  )
  const failResult = await getOrBuildOperationsReportCache(
    failKey,
    async () => {
      throw new Error('模拟构建失败')
    },
    { forceRebuild: true, staleWhileRevalidate: false },
  )
  assert(failResult.warning != null, '构建失败应有 warning', issues)
  assert(failResult.payload.summary != null, '构建失败应返回旧 payload', issues)

  // cache key 设计
  const keyStr = buildOperationsReportCacheKey(dailyKey)
  assert(keyStr.includes('daily'), 'cache key 应含 kind', issues)
  assert(keyStr.includes(dailyDate), 'cache key 应含日期', issues)

  // 16 登录身份分缓存：admin / staff 不共用；未传身份时 fallback local_viewer
  invalidateOperationsReportCache('身份分缓存验收')
  const adminIdentity = { role: 'super_admin' as const, username: 'admin' }
  const staffIdentity = { role: 'staff' as const, username: 'staff1' }

  const adminDailyKey = { ...dailyKey, ...adminIdentity }
  const staffDailyKey = { ...dailyKey, ...staffIdentity }

  await getOrBuildOperationsReportCache(adminDailyKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: dailyDate,
      endDate: dailyDate,
      ...adminIdentity,
    }),
  )
  const staffDaily = await getOrBuildOperationsReportCache(staffDailyKey, () =>
    buildDailyOperationsReport({
      preset: 'custom',
      startDate: dailyDate,
      endDate: dailyDate,
      ...staffIdentity,
    }),
  )
  assert(staffDaily.cache.hit === false, '不同身份应使用不同缓存 key', issues)

  const adminKeyStr = buildOperationsReportCacheKey(adminDailyKey)
  const staffKeyStr = buildOperationsReportCacheKey(staffDailyKey)
  assert(adminKeyStr !== staffKeyStr, 'admin 与 staff 缓存 key 必须不同', issues)
  assert(adminKeyStr.includes('admin'), 'admin 缓存 key 应含 admin', issues)
  assert(staffKeyStr.includes('staff1'), 'staff 缓存 key 应含 staff1', issues)

  const preservedAdmin = buildOperationsReportCacheKey({
    kind: 'daily',
    startDate: dailyDate,
    endDate: dailyDate,
    preset: 'custom',
    scope: 'daily',
    role: 'super_admin',
    username: 'admin',
  })
  assert(preservedAdmin.includes('super_admin'), '真实登录身份不应被覆盖为 local_viewer', issues)
  assert(!preservedAdmin.includes('local_viewer'), '真实登录身份不应被覆盖为 local_viewer', issues)

  const viewer = getLocalViewerCacheIdentity()
  assert(viewer.role === LOCAL_VIEWER_USER.role, '本地看板身份应为 local_viewer', issues)
  assert(viewer.username === LOCAL_VIEWER_USER.username, '本地看板身份应为 本地看板', issues)

  const localOnlyKey = buildOperationsReportCacheKey({
    kind: 'daily',
    startDate: dailyDate,
    endDate: dailyDate,
    preset: 'custom',
    scope: 'daily',
  })
  assert(localOnlyKey.includes('local_viewer'), '未传身份时应 fallback local_viewer', issues)
  assert(localOnlyKey.includes('本地看板'), '未传身份时应 fallback 本地看板', issues)

  // HTTP 状态/预热（维护工具开启时）
  try {
    const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
    if (health.ok) {
      const statusRes = await acceptanceFetch('/api/board/operations-report-cache/status', {
        baseUrl: BASE,
      })
      if (statusRes.status === 200) {
        const body = (await statusRes.json()) as { ok?: boolean; data?: { entryCount?: number } }
        assert(body.ok === true, 'HTTP 缓存状态接口 ok', issues)
        assert(typeof body.data?.entryCount === 'number', 'HTTP 缓存状态 entryCount', issues)
      } else if (statusRes.status !== 404) {
        issues.push(`HTTP 缓存状态接口意外状态 ${statusRes.status}`)
      }
    }
  } catch {
    // 服务未启动时跳过 HTTP 层
  }

  if (issues.length > 0) {
    console.error('[accept:operations-report-cache] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[accept:operations-report-cache] PASS')
}

main().catch((err) => {
  console.error('[accept:operations-report-cache] ERROR', err)
  process.exit(1)
})
