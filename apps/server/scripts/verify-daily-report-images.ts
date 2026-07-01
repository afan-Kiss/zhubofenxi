/**
 * 日报发货前照片 API 验收
 * 用法: npm run verify:daily-report-images
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  cleanupExpiredDailyReportImages,
  deleteDailyReportImage,
  getDailyReportImageFile,
  listDailyReportImages,
  uploadDailyReportImage,
  getDailyReportImagesDir,
  DAILY_REPORT_IMAGE_TTL_MS,
} from '../src/services/daily-report-image.service'
import { getDataDir } from '../src/config/env'
import { prisma } from '../src/lib/prisma'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function run(): Promise<void> {
  const issues: string[] = []
  const reportDate = '2099-01-01'
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ])

  const uploaded = await uploadDailyReportImage({
    reportDate,
    buffer: pngHeader,
    originalName: 'test.png',
    mimeType: 'image/png',
    caption: '测试',
    uploadedBy: 'verify',
  })

  assert(uploaded.publicUrl.includes(uploaded.id), 'publicUrl 应包含 id', issues)
  assert(uploaded.caption === '测试', 'caption 应保存', issues)

  const listed = await listDailyReportImages(reportDate)
  assert(listed.length >= 1, '应按日期列出图片', issues)

  const file = await getDailyReportImageFile(uploaded.id)
  assert(fs.existsSync(file.absPath), '磁盘文件应存在', issues)
  assert(file.absPath.startsWith(getDailyReportImagesDir(reportDate)), '文件应在日期目录下', issues)
  assert(file.absPath.includes(`${reportDate}${path.sep}`) || file.absPath.includes(`${reportDate}/`), '新上传应存日期子目录', issues)

  const dataRoot = path.join(getDataDir(), 'daily-report-images')
  assert(dataRoot.includes('data'), '图片目录应在 data 下', issues)

  await deleteDailyReportImage(uploaded.id)
  const afterDelete = await listDailyReportImages(reportDate)
  assert(!afterDelete.some((r) => r.id === uploaded.id), '删除后列表应不含该图片', issues)

  const expired = await uploadDailyReportImage({
    reportDate,
    buffer: pngHeader,
    originalName: 'expired.png',
    mimeType: 'image/png',
  })
  const expiredAt = new Date(Date.now() - DAILY_REPORT_IMAGE_TTL_MS - 60_000)
  await prisma.dailyReportImage.update({
    where: { id: expired.id },
    data: { createdAt: expiredAt },
  })
  const fresh = await uploadDailyReportImage({
    reportDate,
    buffer: pngHeader,
    originalName: 'fresh.png',
    mimeType: 'image/png',
  })

  const cleaned = await cleanupExpiredDailyReportImages({ force: true })
  assert(cleaned.removedRecords >= 1, '应清理至少 1 条过期记录', issues)

  const remaining = await listDailyReportImages(reportDate)
  assert(!remaining.some((r) => r.id === expired.id), '过期图片应从列表移除', issues)
  assert(remaining.some((r) => r.id === fresh.id), '未过期图片应保留', issues)

  await deleteDailyReportImage(fresh.id)

  if (issues.length) {
    console.error('verify:daily-report-images FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:daily-report-images OK')
}

void run().catch((err) => {
  console.error(err)
  process.exit(1)
})
