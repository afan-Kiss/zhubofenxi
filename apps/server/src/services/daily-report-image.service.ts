import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { getDataDir } from '../config/env'
import { logInfo, logWarn } from '../utils/server-log'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 10 * 1024 * 1024
/** 发货前照片仅保留 24 小时（按上传时间 createdAt） */
export const DAILY_REPORT_IMAGE_TTL_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const REPORT_DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/

let lastCleanupAt = 0

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

function dailyReportImagesRoot(): string {
  return path.join(getDataDir(), 'daily-report-images')
}

/** 支持相对路径（推荐）与历史绝对路径 */
export function resolveDailyReportImageAbsPath(storedPath: string): string {
  const root = path.resolve(dailyReportImagesRoot())
  const normalized = storedPath.trim().replace(/\\/g, '/')
  const resolved = path.isAbsolute(storedPath)
    ? path.resolve(storedPath)
    : path.resolve(root, normalized)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
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
  const storedRelativePath = `${params.reportDate}/${fileName}`

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
      filePath: storedRelativePath,
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
    const absPath = resolveDailyReportImageAbsPath(row.filePath)
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath)
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
  const absPath = resolveDailyReportImageAbsPath(row.filePath)
  if (!fs.existsSync(absPath)) throw new Error('图片文件不存在')
  return { absPath, mimeType: row.mimeType, originalName: row.originalName }
}

function removeEmptyReportDateDirs(): number {
  const root = dailyReportImagesRoot()
  if (!fs.existsSync(root)) return 0
  let removed = 0
  for (const name of fs.readdirSync(root)) {
    if (!REPORT_DATE_DIR_RE.test(name)) continue
    const dir = path.join(root, name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir)
        removed++
      }
    } catch {
      // ignore
    }
  }
  return removed
}

/** 仅清理 DailyReportImage 表中超时记录及其 data/daily-report-images 下对应文件 */
export async function cleanupExpiredDailyReportImages(options?: {
  now?: Date
  force?: boolean
}): Promise<{ removedRecords: number; removedFiles: number; removedEmptyDirs: number }> {
  const nowMs = (options?.now ?? new Date()).getTime()
  if (!options?.force && nowMs - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return { removedRecords: 0, removedFiles: 0, removedEmptyDirs: 0 }
  }
  lastCleanupAt = nowMs

  const cutoff = new Date(nowMs - DAILY_REPORT_IMAGE_TTL_MS)
  const expired = await prisma.dailyReportImage.findMany({
    where: { createdAt: { lt: cutoff } },
  })

  let removedRecords = 0
  let removedFiles = 0

  for (const row of expired) {
    try {
      try {
        const absPath = resolveDailyReportImageAbsPath(row.filePath)
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath)
          removedFiles++
        }
      } catch (err) {
        logWarn(
          '日报图片',
          `跳过删除文件 id=${row.id}：${err instanceof Error ? err.message : String(err)}`,
        )
      }
      await prisma.dailyReportImage.delete({ where: { id: row.id } })
      removedRecords++
    } catch (err) {
      logWarn(
        '日报图片',
        `清理记录失败 id=${row.id}：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const removedEmptyDirs = removeEmptyReportDateDirs()
  if (removedRecords > 0 || removedFiles > 0) {
    logInfo(
      '日报图片',
      `已清理过期发货照片：记录 ${removedRecords} 条，文件 ${removedFiles} 个，空目录 ${removedEmptyDirs} 个`,
    )
  }
  return { removedRecords, removedFiles, removedEmptyDirs }
}

export function startDailyReportImageCleanupTimer(): void {
  void cleanupExpiredDailyReportImages({ force: true }).catch((err) => {
    logWarn('日报图片', `启动清理失败：${err instanceof Error ? err.message : String(err)}`)
  })
  setInterval(() => {
    void cleanupExpiredDailyReportImages({ force: true }).catch((err) => {
      logWarn('日报图片', `定时清理失败：${err instanceof Error ? err.message : String(err)}`)
    })
  }, CLEANUP_INTERVAL_MS).unref()
}
