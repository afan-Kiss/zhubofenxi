import { Router } from 'express'
import fs from 'node:fs'
import { attachRequestUser } from '../middleware/local-viewer.middleware'
import { requireAuth } from '../middleware/auth.middleware'
import { requirePagePermission } from '../middleware/page-permission.middleware'
import { sendFail, sendOk } from '../utils/response'
import { listCsChatSessions, getCsChatSessionMessages } from '../services/refund-analysis/cs-chat-query.service'
import { syncCsChatSessions } from '../services/refund-analysis/cs-chat-sync.service'
import {
  proxyGoodReviewImage,
  touchGoodReviewImageSession,
  closeGoodReviewImageSession,
} from '../services/good-review/good-review-image-proxy.service'
import { normalizeMediaUrl } from '../services/refund-analysis/cs-chat-normalize'

export const refundAnalysisRouter = Router()

refundAnalysisRouter.get('/image-proxy', attachRequestUser, requireAuth, async (req, res, next) => {
  try {
    const rawUrl = String(req.query.url ?? '').trim()
    const sessionId = String(req.query.sessionId ?? '').trim() || undefined
    if (!rawUrl) {
      sendFail(res, '请提供 url 参数', 400)
      return
    }
    let decoded = rawUrl
    try {
      decoded = decodeURIComponent(rawUrl)
    } catch {
      decoded = rawUrl
    }
    const normalized = normalizeMediaUrl(decoded) || decoded
    const result = await proxyGoodReviewImage({ rawUrl: normalized, sessionId })
    if (!result.ok) {
      const accept = String(req.headers.accept ?? '')
      if (accept.includes('image/') || accept.includes('*/*')) {
        res.status(502)
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.send(
          `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="320" height="120" fill="#f8fafc"/><text x="160" y="56" text-anchor="middle" fill="#64748b" font-size="14">图片加载失败</text></svg>`,
        )
        return
      }
      sendFail(res, result.message, 404)
      return
    }
    if (sessionId) touchGoodReviewImageSession(sessionId, normalized)
    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Cache-Control', 'private, max-age=1800')
    fs.createReadStream(result.file).pipe(res)
  } catch (err) {
    next(err)
  }
})

refundAnalysisRouter.post('/image-session/close', (req, res) => {
  const sessionId = String(req.body?.sessionId ?? '').trim()
  if (sessionId) closeGoodReviewImageSession(sessionId)
  sendOk(res, { ok: true })
})

refundAnalysisRouter.use(
  attachRequestUser,
  requireAuth,
  requirePagePermission('refund_analysis'),
)

refundAnalysisRouter.get('/sessions', async (req, res, next) => {
  try {
    const data = await listCsChatSessions({
      shopTitle: String(req.query.shop ?? '').trim() || undefined,
      keyword: String(req.query.keyword ?? '').trim() || undefined,
      refundOnly: String(req.query.refundOnly ?? '') === '1',
      hasImage: String(req.query.hasImage ?? '') === '1',
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    })
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

refundAnalysisRouter.get('/sessions/:sessionId', async (req, res, next) => {
  try {
    const sessionId = decodeURIComponent(String(req.params.sessionId || ''))
    const data = await getCsChatSessionMessages(sessionId)
    if (!data.session) {
      sendFail(res, '会话不存在', 404)
      return
    }
    sendOk(res, data)
  } catch (err) {
    next(err)
  }
})

refundAnalysisRouter.post('/sync', async (req, res, next) => {
  try {
    const days = Number(req.body?.days) || 60
    const preferLive = req.body?.preferLive !== false
    const archivePath =
      typeof req.body?.archivePath === 'string' ? req.body.archivePath.trim() : undefined
    const result = await syncCsChatSessions({ days, preferLive, archivePath })
    if (!result.ok) {
      sendFail(res, result.message || '同步失败', 400)
      return
    }
    sendOk(res, result)
  } catch (err) {
    next(err)
  }
})
