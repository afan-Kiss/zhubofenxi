/**
 * Cookie / 本地缓存韧性验收
 * 用法: npm run accept:local-cache-cookie
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import type { BoardLiveQueryPreset } from '../src/services/board-live-query.service'
import { testLiveAccountCookie } from '../src/services/live-account.service'
import { buildBusinessRangeKey } from '../src/utils/business-range'

config({ path: path.resolve(__dirname, '../.env') })

const REQUIRED_SUMMARY_FIELDS = [
  'orderCount',
  'totalGmv',
  'actualSignedAmount',
  'signedOrderCount',
  'signRate',
  'returnAmount',
  'returnRate',
  'qualityReturnCount',
  'returnCount',
] as const

const PRESETS: Array<{ preset: BoardLiveQueryPreset; startDate?: string; endDate?: string }> = [
  { preset: 'today' },
  { preset: 'yesterday' },
  { preset: 'thisWeek' },
  { preset: 'thisMonth' },
  { preset: 'lastMonth' },
  { preset: 'custom', startDate: '2026-06-01', endDate: '2026-06-30' },
]

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function validateSummaryFields(summary: Record<string, unknown>, label: string, issues: string[]) {
  for (const key of REQUIRED_SUMMARY_FIELDS) {
    assert(key in summary, `${label} summary 缺少字段 ${key}`, issues)
  }
  for (const key of ['totalGmv', 'actualSignedAmount', 'returnAmount'] as const) {
    assert(isNumber(summary[key]), `${label} ${key} 必须是 number`, issues)
  }
  for (const key of ['orderCount', 'signedOrderCount', 'qualityReturnCount', 'returnCount'] as const) {
    assert(isNumber(summary[key]), `${label} ${key} 必须是 number`, issues)
  }
}

function staticCheckBoardLiveQueryProvider(issues: string[]) {
  const file = path.resolve(__dirname, '../../web/src/providers/BoardLiveQueryProvider.tsx')
  const src = fs.readFileSync(file, 'utf-8')
  assert(
    !/Promise\.all\(\[\s*fetchBoardLocalData[\s\S]*fetchBoardSyncMeta/.test(src),
    'BoardLiveQueryProvider 不应再用 Promise.all 让 fetchBoardSyncMeta 拖死 fetchBoardLocalData',
    issues,
  )
  assert(
    src.includes('fetchBoardLocalData({') && src.includes('void fetchBoardSyncMeta'),
    'BoardLiveQueryProvider 应以 fetchBoardLocalData 为主、fetchBoardSyncMeta 为辅助',
    issues,
  )
  assert(
    src.includes('rangeMatched ? displaySummary : null'),
    'BoardLiveQueryProvider 应仅在 rangeMatched 时暴露 displaySummary',
    issues,
  )
}

function staticCheckBusinessCacheStaleIfError(issues: string[]) {
  const file = path.resolve(__dirname, '../src/services/business-cache.service.ts')
  const src = fs.readFileSync(file, 'utf-8')
  const fnStart = src.indexOf('export async function buildAndSetBusinessBoardCache')
  const fnBody = fnStart >= 0 ? src.slice(fnStart, fnStart + 2500) : ''
  assert(
    !fnBody.includes('evictBusinessBoardCacheEntry(key'),
    'buildAndSetBusinessBoardCache 不应在构建前 evict 旧缓存',
    issues,
  )
  assert(
    src.includes('fallbackFromPreviousCache'),
    'business-cache 应提供 build 失败回退旧缓存逻辑',
    issues,
  )
  assert(src.includes('stale?: boolean'), 'BusinessBoardCacheEntry 应包含 stale 字段', issues)
}

function staticCheckSyncMetaCookieDegraded(issues: string[]) {
  const file = path.resolve(__dirname, '../src/services/board-sync-meta.service.ts')
  const src = fs.readFileSync(file, 'utf-8')
  const fnStart = src.indexOf('export async function buildBoardSyncMetaForApi')
  const fnBody = fnStart >= 0 ? src.slice(fnStart, fnStart + 3500) : ''
  assert(
    fnBody.includes('buildDegradedCookieHealth'),
    'board-sync-meta 应提供 Cookie 健康降级结构',
    issues,
  )
  assert(
    /try\s*\{[\s\S]*getCookieHealthPayload/.test(fnBody),
    'getCookieHealthPayload 应单独 try/catch',
    issues,
  )
  const promiseAllMatch = fnBody.match(/Promise\.all\(\[([\s\S]*?)\]\)/)
  assert(
    !promiseAllMatch?.[1]?.includes('getCookieHealthPayload'),
    'getCookieHealthPayload 不应与 sync-meta 主流程同批 Promise.all',
    issues,
  )
}

async function testCookieInvalidDoesNotBreakLocalQuery(issues: string[]) {
  const cred = await prisma.platformCredential.findFirst({
    where: { cookieEncrypted: { not: '' } },
    orderBy: { createdAt: 'asc' },
  })
  if (!cred) {
    issues.push('跳过 Cookie invalid 测试：无 platformCredential')
    return
  }

  const backup = {
    cookieStatus: cred.cookieStatus,
    cookieLastCheckedAt: cred.cookieLastCheckedAt,
    cookieLastErrorMessage: cred.cookieLastErrorMessage,
    cookieLastErrorCode: cred.cookieLastErrorCode,
    cookieLastFailedAt: cred.cookieLastFailedAt,
    cookieLastFailedApi: cred.cookieLastFailedApi,
  }

  const now = new Date()
  await prisma.platformCredential.update({
    where: { id: cred.id },
    data: {
      cookieStatus: 'invalid',
      cookieLastCheckedAt: now,
      cookieLastErrorMessage: 'accept:local-cache-cookie 测试错误',
      cookieLastErrorCode: 'test_invalid',
      cookieLastFailedAt: now,
      cookieLastFailedApi: 'order_list',
    },
  })

  try {
    for (const item of PRESETS) {
      const label = item.preset === 'custom'
        ? `custom ${item.startDate}~${item.endDate}`
        : item.preset
      let result
      try {
        result = await executeBoardLocalQuery({
          preset: item.preset,
          startDate: item.startDate,
          endDate: item.endDate,
        })
      } catch (e) {
        issues.push(`${label} executeBoardLocalQuery throw: ${e instanceof Error ? e.message : e}`)
        continue
      }

      const expectedKey = buildBusinessRangeKey(
        item.preset,
        result.startDate,
        result.endDate,
      )
      assert(
        result.rangeKey === expectedKey,
        `${label} rangeKey 不一致：${result.rangeKey} vs ${expectedKey}`,
        issues,
      )
      validateSummaryFields(result.summary as Record<string, unknown>, label, issues)

      console.log(
        `[local-cache-cookie] ${label} rangeKey=${result.rangeKey} orders=${result.summary.orderCount} gmv=${result.summary.totalGmv} status=${result.dataDisplayStatus}`,
      )
    }
  } finally {
    await prisma.platformCredential.update({
      where: { id: cred.id },
      data: backup,
    })
  }
}

async function testCookieTestCooldown(issues: string[]) {
  const cred = await prisma.platformCredential.findFirst({
    where: { cookieEncrypted: { not: '' } },
    orderBy: { createdAt: 'asc' },
  })
  if (!cred) {
    issues.push('跳过 Cookie 冷却测试：无 platformCredential')
    return
  }

  const now = new Date()
  await prisma.platformCredential.update({
    where: { id: cred.id },
    data: { cookieLastCheckedAt: now },
  })

  const result = await testLiveAccountCookie(cred.id)
  assert(result.fromCooldown === true, 'testLiveAccountCookie 冷却期内应返回 fromCooldown=true', issues)
  assert(
    (result.cooldownRemainingSeconds ?? 0) > 0,
    'testLiveAccountCookie 冷却期内 cooldownRemainingSeconds 应 > 0',
    issues,
  )
  assert(
    result.message.includes('冷却'),
    'testLiveAccountCookie 冷却期内 message 应提示冷却',
    issues,
  )
  assert(
    result.checkedAt != null,
    'testLiveAccountCookie 冷却期内 checkedAt 应来自上次检测时间',
    issues,
  )
}

async function testLastMonthVsThisMonthDistinct(issues: string[]) {
  const [thisMonth, lastMonth] = await Promise.all([
    executeBoardLocalQuery({ preset: 'thisMonth' }),
    executeBoardLocalQuery({ preset: 'lastMonth' }),
  ])

  assert(thisMonth.rangeKey !== lastMonth.rangeKey, '本月与上月 rangeKey 不应相同', issues)
  assert(
    thisMonth.startDate !== lastMonth.startDate || thisMonth.endDate !== lastMonth.endDate,
    '本月与上月 startDate/endDate 不应完全相同',
    issues,
  )

  console.log(
    `[local-cache-cookie] thisMonth ${thisMonth.startDate}~${thisMonth.endDate} orders=${thisMonth.summary.orderCount}`,
  )
  console.log(
    `[local-cache-cookie] lastMonth ${lastMonth.startDate}~${lastMonth.endDate} orders=${lastMonth.summary.orderCount}`,
  )
}

async function main() {
  const issues: string[] = []
  staticCheckBoardLiveQueryProvider(issues)
  staticCheckBusinessCacheStaleIfError(issues)
  staticCheckSyncMetaCookieDegraded(issues)

  await testCookieInvalidDoesNotBreakLocalQuery(issues)
  await testCookieTestCooldown(issues)
  await testLastMonthVsThisMonthDistinct(issues)

  if (issues.length > 0) {
    console.error('\n[accept:local-cache-cookie] FAILED:')
    for (const issue of issues) console.error(`  - ${issue}`)
    process.exit(1)
  }

  console.log('\n[accept:local-cache-cookie] PASS')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
