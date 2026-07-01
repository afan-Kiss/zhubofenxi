/**
 * 日报发货前照片 API 验收
 * 用法: npm run verify:daily-report-images
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  deleteDailyReportImage,
  getDailyReportImageFile,
  listDailyReportImages,
  uploadDailyReportImage,
  getDailyReportImagesDir,
} from '../src/services/daily-report-image.service'
import { getDataDir } from '../src/config/env'

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

  const dataRoot = path.join(getDataDir(), 'daily-report-images')
  assert(dataRoot.includes('data'), '图片目录应在 data 下', issues)

  await deleteDailyReportImage(uploaded.id)
  const afterDelete = await listDailyReportImages(reportDate)
  assert(!afterDelete.some((r) => r.id === uploaded.id), '删除后列表应不含该图片', issues)

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
