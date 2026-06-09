import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import { getValidationPackageDir } from '../config/env'
import {
  buildValidationPackageFileName,
} from './validation-package-builder.service'
import { writeOperationLog } from './audit.service'
import { findUserById } from './user.service'

export async function resolveSnapshotForValidation(_snapshotId: string): Promise<null> {
  return null
}

export interface ValidationPackageListItem {
  id: string
  snapshotId: string
  fileName: string
  fileSize: number
  status: string
  errorMessage: string | null
  createdAt: string
  finishedAt: string | null
  downloadUrl: string | null
}

export async function listValidationPackages(limit = 20): Promise<ValidationPackageListItem[]> {
  const rows = await prisma.validationPackage.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    snapshotId: r.snapshotId,
    fileName: r.fileName,
    fileSize: r.fileSize,
    status: r.status,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    downloadUrl:
      r.status === 'success' ? `/api/validation/packages/${r.id}/download` : null,
  }))
}

export async function createValidationPackage(
  snapshotId: string,
  userId: string,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<{ packageId: string; fileName: string; downloadUrl: string }> {
  void snapshotId
  void userId
  void audit
  throw new Error('校验包导出已停用快照；请使用「导出当前系统数据核对表」（live-query）')
}

export async function getValidationPackageFile(
  packageId: string,
): Promise<{ filePath: string; fileName: string } | null> {
  const row = await prisma.validationPackage.findUnique({ where: { id: packageId } })
  if (!row || row.status !== 'success' || !fs.existsSync(row.filePath)) {
    return null
  }
  return { filePath: row.filePath, fileName: row.fileName }
}
