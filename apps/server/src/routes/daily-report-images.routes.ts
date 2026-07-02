import { Router, type Request } from 'express'
import Busboy from 'busboy'
import fs from 'node:fs'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import {
  deleteDailyReportImage,
  getDailyReportImageFile,
  listDailyReportImages,
  patchDailyReportImage,
  uploadDailyReportImage,
} from '../services/daily-report-image.service'
import {
  createDailyReportUploadToken,
  validateDailyReportUploadToken,
} from '../services/daily-report-upload-token.service'
import { sendFail, sendOk } from '../utils/response'

export const dailyReportImagesRouter = Router()

async function parseMultipartUpload(req: Request): Promise<{
  reportDate: string
  caption: string
  uploadToken: string
  buffer: Buffer
  originalName: string
  mimeType: string
}> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    })
    let reportDate = ''
    let caption = ''
    let uploadToken = String(req.headers['x-daily-report-upload-token'] ?? '').trim()
    let fileBuffer: Buffer | null = null
    let originalName = 'upload.jpg'
    let mimeType = 'application/octet-stream'

    busboy.on('field', (name, value) => {
      if (name === 'reportDate') reportDate = String(value).trim()
      if (name === 'caption') caption = String(value)
      if (name === 'uploadToken') uploadToken = String(value).trim()
    })

    busboy.on('file', (_name, file, info) => {
      originalName = info.filename || originalName
      mimeType = info.mimeType || mimeType
      const chunks: Buffer[] = []
      file.on('data', (chunk: Buffer) => chunks.push(chunk))
      file.on('limit', () => reject(new Error('单张图片不能超过 10MB')))
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks)
      })
    })

    busboy.on('error', reject)
    busboy.on('finish', () => {
      if (!reportDate) {
        reject(new Error('请提供 reportDate'))
        return
      }
      if (!fileBuffer || fileBuffer.length === 0) {
        reject(new Error('请上传图片文件'))
        return
      }
      resolve({ reportDate, caption, uploadToken, buffer: fileBuffer, originalName, mimeType })
    })

    req.pipe(busboy)
  })
}

/** 手机扫码上传（无需登录，凭短期 token） */
dailyReportImagesRouter.post('/mobile', async (req, res) => {
  try {
    const parsed = await parseMultipartUpload(req)
    if (!validateDailyReportUploadToken(parsed.uploadToken, parsed.reportDate)) {
      sendFail(res, '上传链接无效或已过期，请在电脑端重新扫码', 403)
      return
    }
    const image = await uploadDailyReportImage({
      reportDate: parsed.reportDate,
      buffer: parsed.buffer,
      originalName: parsed.originalName,
      mimeType: parsed.mimeType,
      caption: parsed.caption,
      uploadedBy: 'mobile-upload',
    })
    sendOk(res, { image }, 201)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '上传失败', 400)
  }
})

dailyReportImagesRouter.use(attachRequestUser, requireAuth)

dailyReportImagesRouter.get('/upload-token', async (req, res) => {
  try {
    const date = String(req.query.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date 参数', 400)
      return
    }
    const payload = createDailyReportUploadToken(date, req.user?.username)
    sendOk(res, payload)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '生成上传链接失败', 400)
  }
})

dailyReportImagesRouter.get('/', async (req, res, next) => {
  try {
    const date = String(req.query.date ?? '').trim()
    if (!date) {
      sendFail(res, '请提供 date 参数', 400)
      return
    }
    const images = await listDailyReportImages(date)
    sendOk(res, { images })
  } catch (err) {
    next(err)
  }
})

dailyReportImagesRouter.post('/', async (req, res, next) => {
  try {
    const parsed = await parseMultipartUpload(req)
    const image = await uploadDailyReportImage({
      reportDate: parsed.reportDate,
      buffer: parsed.buffer,
      originalName: parsed.originalName,
      mimeType: parsed.mimeType,
      caption: parsed.caption,
      uploadedBy: req.user?.username,
    })
    sendOk(res, { image }, 201)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '上传失败', 400)
  }
})

dailyReportImagesRouter.get('/:id/file', async (req, res, next) => {
  try {
    const { absPath, mimeType, originalName } = await getDailyReportImageFile(String(req.params.id))
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`)
    fs.createReadStream(absPath).pipe(res)
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '读取图片失败', 404)
  }
})

dailyReportImagesRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteDailyReportImage(String(req.params.id))
    sendOk(res, { deleted: true })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '删除失败', 400)
  }
})

dailyReportImagesRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const image = await patchDailyReportImage(String(req.params.id), {
      caption: body.caption !== undefined ? String(body.caption) : undefined,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
    })
    sendOk(res, { image })
  } catch (err) {
    sendFail(res, err instanceof Error ? err.message : '更新失败', 400)
  }
})
