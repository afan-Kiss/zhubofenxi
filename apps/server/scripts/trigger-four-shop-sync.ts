/**
 * 触发四店经营同步并等待完成
 * 用法: npx tsx apps/server/scripts/trigger-four-shop-sync.ts
 */
import { prisma } from '../src/lib/prisma'
import { runDailyStrategySyncJob } from '../src/services/daily-sync-strategy.service'

async function main(): Promise<void> {
  const { jobId, alreadyRunning } = await runDailyStrategySyncJob({
    triggeredBy: 'verify-four-shops',
  })
  console.log(JSON.stringify({ jobId, alreadyRunning }))
  if (alreadyRunning) {
    console.log('sync already running, skip wait')
    await prisma.$disconnect()
    return
  }
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const job = await prisma.xhsSyncJob.findUnique({ where: { id: jobId } })
    if (!job) break
    console.log(
      JSON.stringify({
        poll: i,
        status: job.status,
        step: job.currentStepLabel,
        progress: job.progress,
        error: job.errorMessage,
      }),
    )
    if (job.status === 'success' || job.status === 'failed') break
  }
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
