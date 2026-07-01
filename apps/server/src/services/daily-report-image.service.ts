import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { getDataDir } from '../config/env'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 10 * 1024 * 1024

export interface DailyReportImageDto {
  id: string
  reportDate: string
  publicUrl: string
  originalName: string
  mimeType: string
  size: number
  caption: string | null
  sortOrder: number
  uploadedBy: string | null
  createdAt: string
}

function toDto(row: {
  id: string
  reportDate: string
  publicUrl: string
  originalName: string
  mimeType: string
  size: number
  caption: string | null
  sortOrder: number
  uploadedBy: string | null
  createdAt: Date
}): DailyReportImageDto {
  return {
    id: row.id,
    reportDate: row.reportDate,
    publicUrl: row.publicUrl,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    caption: row.caption,
    sortOrder: row.sortOrder,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

export function getDailyReportImagesDir(reportDate: string): string {
  return path.join(getDataDir(), 'daily-report-images', reportDate)
}

export function resolveDailyReportImageFilePath(storedPath: string): string {
  const base = path.resolve(getDataDir(), 'daily-report-images')
  const resolved = path.resolve(storedPath)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('无效的图片路径')
  }
  return resolved
}

export async function listDailyReportImages(reportDate: string): Promise<DailyReportImageDto[]> {
  const rows = await prisma.dailyReportImage.findMany({
    where: { reportDate },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(toDto)
}

export async function uploadDailyReportImage(params: {
  reportDate: string
  buffer: Buffer
  originalName: string
  mimeType: string
  caption?: string
  uploadedBy?: string
}): Promise<DailyReportImageDto> {
  const mime = params.mimeType.toLowerCase()
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error('仅支持 jpg / png / webp 图片')
  }
  if (params.buffer.length > MAX_BYTES) {
    throw new Error('单张图片不能超过 10MB')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.reportDate)) {
    throw new Error('reportDate 格式应为 YYYY-MM-DD')
  }

  const ext =
    mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'
  const id = randomUUID()
  const dir = getDailyReportImagesDir(params.reportDate)
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `${id}${ext}`
  const absPath = path.join(dir, fileName)
  fs.writeFileSync(absPath, params.buffer)

  const maxSort = await prisma.dailyReportImage.aggregate({
    where: { reportDate: params.reportDate },
    _max: { sortOrder: true },
  })
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1
  const publicUrl = `/api/daily-report-images/${id}/file`

  const row = await prisma.dailyReportImage.create({
    data: {
      id,
      reportDate: params.reportDate,
      filePath: absPath,
      publicUrl,
      originalName: params.originalName.slice(0, 200),
      mimeType: mime,
      size: params.buffer.length,
      caption: params.caption?.trim() || null,
      sortOrder,
      uploadedBy: params.uploadedBy ?? null,
    },
  })
  return toDto(row)
}

export async function deleteDailyReportImage(id: string): Promise<void> {
  const row = await prisma.dailyReportImage.findUnique({ where: { id } })
  if (!row) throw new Error('图片不存在')
  try {
    if (fs.existsSync(row.filePath)) fs.unlinkSync(row.filePath)
  } catch {
    // ignore missing file
  }
  await prisma.dailyReportImage.delete({ where: { id } })
}

export async function patchDailyReportImage(
  id: string,
  patch: { caption?: string | null; sortOrder?: number },
): Promise<DailyReportImageDto> {
  const row = await prisma.dailyReportImage.update({
    where: { id },
    data: {
      ...(patch.caption !== undefined ? { caption: patch.caption?.trim() || null } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    },
  })
  return toDto(row)
}

export async function getDailyReportImageFile(id: string): Promise<{
  absPath: string
  mimeType: string
  originalName: string
}> {
  const row = await prisma.dailyReportImage.findUnique({ where: { id } })
  if (!row) throw new Error('图片不存在')
  const absPath = resolveDailyReportImageFilePath(row.filePath)
  if (!fs.existsSync(absPath)) throw new Error('图片文件不存在')
  return { absPath, mimeType: row.mimeType, originalName: row.originalName }
}
