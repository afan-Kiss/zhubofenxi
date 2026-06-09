import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import {
  getBackupDir,
  getDatabasePath,
  getDownloadDir,
  getPort,
  getReportDir,
  isProduction,
} from '../config/env'
import { getCredentialPublic } from './credential.service'

const SERVER_STARTED_AT = new Date()

function countFilesInDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let n = 0
  const walk = (p: string) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.isFile()) n += 1
    }
  }
  walk(dir)
  return n
}

export async function getSystemStatus() {
  let dbOk = false
  try {
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    dbOk = false
  }

  const downloadDir = getDownloadDir()
  const reportDir = getReportDir()
  const backupDir = getBackupDir()
  const cookie = await getCredentialPublic()

  const lastScheduled = await prisma.refreshJob.findFirst({
    where: { type: 'scheduled', status: { in: ['success', 'partial_success', 'failed', 'skipped'] } },
    orderBy: { finishedAt: 'desc' },
  })
  const lastManual = await prisma.refreshJob.findFirst({
    where: { type: 'manual' },
    orderBy: { createdAt: 'desc' },
  })
  const runningJob = await prisma.refreshJob.findFirst({
    where: { status: 'running' },
    orderBy: { createdAt: 'desc' },
  })
  const lastSync = await prisma.xhsSyncJob.findFirst({
    where: { status: { in: ['success', 'partial_success'] } },
    orderBy: { finishedAt: 'desc' },
  })

  const uptimeSec = Math.floor((Date.now() - SERVER_STARTED_AT.getTime()) / 1000)

  return {
    startedAt: SERVER_STARTED_AT.toISOString(),
    uptimeSeconds: uptimeSec,
    environment: process.env.NODE_ENV ?? 'development',
    port: getPort(),
    isProduction: isProduction(),
    databaseOk: dbOk,
    databasePath: getDatabasePath(),
    downloadDir,
    downloadDirExists: fs.existsSync(downloadDir),
    reportDir,
    reportDirExists: fs.existsSync(reportDir),
    backupDir,
    backupDirExists: fs.existsSync(backupDir),
    cookieConfigured: cookie.hasCookie,
    lastScheduledRefreshAt: lastScheduled?.finishedAt?.toISOString() ?? null,
    lastManualRefreshAt: lastManual?.finishedAt?.toISOString() ?? lastManual?.startedAt?.toISOString() ?? null,
    lastSnapshotAt: lastSync?.finishedAt?.toISOString() ?? null,
    lastSnapshotTrust: null,
    refreshRunning: Boolean(runningJob),
    runningRefreshJobId: runningJob?.id ?? null,
    downloadFileCount: countFilesInDir(downloadDir),
    reportFileCount: countFilesInDir(reportDir),
    backupFileCount: countFilesInDir(backupDir),
  }
}
