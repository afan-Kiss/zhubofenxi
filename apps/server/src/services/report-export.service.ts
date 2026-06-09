import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import { getReportDir } from '../config/env'
import { writeOperationLog } from './audit.service'
import { findUserById } from './user.service'

export async function resolveSnapshotForReport(_snapshotId: string): Promise<null> {
  return null
}

export async function createReportExport(
  _snapshotId: string,
  userId: string,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<{ reportId: string; downloadUrl: string; fileName: string }> {
  void userId
  void audit
  throw new Error('报表导出已改为使用「导出当前系统数据核对表」（live-query），不再使用分析快照')
}

export async function getReportExportFile(reportId: string): Promise<{
  filePath: string
  fileName: string
} | null> {
  const row = await prisma.reportExport.findUnique({ where: { id: reportId } })
  if (!row || row.status !== 'ready' || !row.filePath || !fs.existsSync(row.filePath)) {
    return null
  }
  return { filePath: row.filePath, fileName: row.fileName }
}
