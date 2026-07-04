/**
 * 一次性：触发四店经营同步并等待完成，验收 XhsRawOrder > 0
 * 用法: npx tsx apps/server/scripts/reinit-trigger-business-sync.ts
 */
import { prisma } from '../src/lib/prisma'
import { GOOD_REVIEW_SHOP_KEYS } from '../src/config/good-review-shops.constants'
import { runDailyStrategySyncJob } from '../src/services/daily-sync-strategy.service'
import { getShopCookieHealth } from '../src/services/shop-cookie-health.service'

async function countTable(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: number | bigint }>>(
    `SELECT COUNT(*) AS c FROM ${table}`,
  )
  return Number(rows[0]?.c ?? 0)
}

async function printDbCounts(label: string): Promise<void> {
  const [users, creds, orders, jobs, liveSessions] = await Promise.all([
    countTable('User'),
    countTable('PlatformCredential'),
    countTable('XhsRawOrder'),
    countTable('XhsSyncJob'),
    countTable('XhsRawLiveSession').catch(() => -1),
  ])
  console.log(
    `[reinit-trigger-business-sync] ${label}`,
    JSON.stringify({ users, creds, orders, jobs, liveSessions }),
  )
}

async function diagnoseFailure(): Promise<void> {
  console.log('[reinit-trigger-business-sync] diagnose:')
  for (const shopKey of GOOD_REVIEW_SHOP_KEYS) {
    const health = await getShopCookieHealth(shopKey)
    console.log(
      JSON.stringify({
        shopKey,
        status: health.status,
        ok: health.ok,
        hasA1: health.hasA1,
        hasArkToken: health.hasArkToken,
        reason: health.reason,
        failedEndpoint: health.failedEndpoint,
        httpStatus: health.httpStatus,
      }),
    )
  }

  const creds = await prisma.platformCredential.findMany({
    where: { platformName: { in: [...GOOD_REVIEW_SHOP_KEYS] } },
    select: {
      platformName: true,
      enabled: true,
      cookieStatus: true,
      cookieLastErrorMessage: true,
      cookieLastFailedApi: true,
      cookieLastErrorCode: true,
    },
  })
  for (const row of creds) {
    console.log(
      JSON.stringify({
        platformName: row.platformName,
        enabled: row.enabled,
        cookieStatus: row.cookieStatus,
        cookieLastErrorCode: row.cookieLastErrorCode,
        cookieLastFailedApi: row.cookieLastFailedApi,
        cookieLastErrorMessage: row.cookieLastErrorMessage,
      }),
    )
  }

  const lastJobs = await prisma.xhsSyncJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      id: true,
      status: true,
      preset: true,
      startDate: true,
      endDate: true,
      errorMessage: true,
      currentStepLabel: true,
      progress: true,
      finishedAt: true,
    },
  })
  for (const job of lastJobs) {
    console.log('[reinit-trigger-business-sync] recent job', JSON.stringify(job))
  }
}

async function main(): Promise<void> {
  await printDbCounts('before sync')

  const enabledCreds = await prisma.platformCredential.findMany({
    where: { platformName: { in: [...GOOD_REVIEW_SHOP_KEYS] }, enabled: true },
    select: { platformName: true, cookieEncrypted: true },
  })
  const missing = GOOD_REVIEW_SHOP_KEYS.filter(
    (key) => !enabledCreds.some((row) => row.platformName === key && row.cookieEncrypted.trim()),
  )
  if (missing.length > 0) {
    throw new Error(`以下店铺未启用或无 Cookie: ${missing.join(', ')}`)
  }

  const { jobId, alreadyRunning } = await runDailyStrategySyncJob({
    triggeredBy: 'reinit-trigger-business-sync',
  })
  console.log('[reinit-trigger-business-sync] started', JSON.stringify({ jobId, alreadyRunning }))

  const targetJobId = jobId
  for (let i = 0; i < 720; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const job = await prisma.xhsSyncJob.findUnique({ where: { id: targetJobId } })
    if (!job) break
    if (i % 6 === 0 || job.status === 'success' || job.status === 'failed') {
      console.log(
        JSON.stringify({
          poll: i,
          status: job.status,
          step: job.currentStepLabel,
          progress: job.progress,
          error: job.errorMessage,
        }),
      )
    }
    if (job.status === 'success' || job.status === 'failed') {
      if (job.status === 'failed') {
        await diagnoseFailure()
        throw new Error(job.errorMessage || '同步任务失败')
      }
      break
    }
  }

  await printDbCounts('after sync')
  const orderCount = await countTable('XhsRawOrder')
  if (orderCount <= 0) {
    await diagnoseFailure()
    throw new Error('同步完成后 XhsRawOrder 仍为 0')
  }

  console.log('[reinit-trigger-business-sync] OK orders=', orderCount)
}

main()
  .catch((err) => {
    console.error('[reinit-trigger-business-sync] FAILED', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
