import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from '../../config/env'
import { normalizeReviewImageUrl } from './good-review-normalize.service'

const CACHE_TTL_MS = 30 * 60 * 1000
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
const REFERER = 'https://ark.xiaohongshu.com/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const ALLOWED_HOST_SUFFIXES = [
  'qimg.xiaohongshu.com',
  'sns-img-qc.xhscdn.com',
  'xhscdn.com',
  'xiaohongshu.com',
]

export interface GoodReviewImageCacheMeta {
  cacheKey: string
  sourceUrlHash: string
  sourceUrl: string
  localPath: string
  contentType: string
  createdAt: string
  lastAccessAt: string
  expiresAt: string
  sessionIds: string[]
  sessionClosedAt: Record<string, string>
}

let lastCleanupAt = 0

function cacheRootDir(): string {
  return path.join(getDataDir(), 'good-review-image-cache')
}

function metaPath(cacheKey: string): string {
  return path.join(cacheRootDir(), `${cacheKey}.meta.json`)
}

function filePath(cacheKey: string, ext: string): string {
  return path.join(cacheRootDir(), `${cacheKey}${ext}`)
}

function ensureCacheDir(): void {
  fs.mkdirSync(cacheRootDir(), { recursive: true })
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

function extFromContentType(contentType: string): string {
  const ct = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (ct.includes('png')) return '.png'
  if (ct.includes('webp')) return '.webp'
  if (ct.includes('gif')) return '.gif'
  return '.jpg'
}

export function isAllowedGoodReviewImageUrl(rawUrl: string): boolean {
  try {
    const normalized = normalizeReviewImageUrl(rawUrl)
    if (!normalized) return false
    const host = new URL(normalized).hostname.toLowerCase()
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

export function normalizeProxyImageUrl(rawUrl: string): string | null {
  const normalized = normalizeReviewImageUrl(rawUrl.trim())
  if (!normalized || !isAllowedGoodReviewImageUrl(normalized)) return null
  return normalized
}

function readMeta(cacheKey: string): GoodReviewImageCacheMeta | null {
  const p = metaPath(cacheKey)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as GoodReviewImageCacheMeta
  } catch {
    return null
  }
}

function writeMeta(meta: GoodReviewImageCacheMeta): void {
  ensureCacheDir()
  fs.writeFileSync(metaPath(meta.cacheKey), JSON.stringify(meta, null, 2), 'utf-8')
}

function shouldDeleteMeta(meta: GoodReviewImageCacheMeta, now: number): boolean {
  const lastAccess = Date.parse(meta.lastAccessAt)
  if (Number.isFinite(lastAccess) && now - lastAccess > CACHE_TTL_MS) return true

  const closedTimes = Object.values(meta.sessionClosedAt)
  if (closedTimes.length > 0 && meta.sessionIds.every((id) => meta.sessionClosedAt[id])) {
    const latestClose = Math.max(...closedTimes.map((t) => Date.parse(t)).filter(Number.isFinite))
    if (Number.isFinite(latestClose) && now - latestClose > CACHE_TTL_MS) return true
  }

  if (!fs.existsSync(meta.localPath)) return true
  try {
    const stat = fs.statSync(meta.localPath)
    if (stat.size <= 0) return true
  } catch {
    return true
  }

  return false
}

export function cleanupGoodReviewImageCache(force = false): number {
  const now = Date.now()
  if (!force && now - lastCleanupAt < CLEANUP_INTERVAL_MS) return 0
  lastCleanupAt = now
  ensureCacheDir()
  let removed = 0
  for (const name of fs.readdirSync(cacheRootDir())) {
    if (!name.endsWith('.meta.json')) continue
    const cacheKey = name.replace(/\.meta\.json$/, '')
    const meta = readMeta(cacheKey)
    if (!meta) {
      fs.rmSync(path.join(cacheRootDir(), name), { force: true })
      removed++
      continue
    }
    if (shouldDeleteMeta(meta, now)) {
      try {
        if (fs.existsSync(meta.localPath)) fs.rmSync(meta.localPath, { force: true })
      } catch {
        // ignore
      }
      fs.rmSync(metaPath(cacheKey), { force: true })
      removed++
    }
  }
  return removed
}

export function createGoodReviewImageSessionId(): string {
  return randomUUID()
}

export function touchGoodReviewImageSession(sessionId: string, sourceUrl: string): void {
  const normalized = normalizeProxyImageUrl(sourceUrl)
  if (!normalized) return
  const cacheKey = sha1(normalized)
  const meta = readMeta(cacheKey)
  if (!meta) return
  const nowIso = new Date().toISOString()
  if (!meta.sessionIds.includes(sessionId)) meta.sessionIds.push(sessionId)
  meta.lastAccessAt = nowIso
  meta.expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString()
  writeMeta(meta)
}

export function closeGoodReviewImageSession(sessionId: string): void {
  if (!sessionId.trim()) return
  ensureCacheDir()
  const nowIso = new Date().toISOString()
  for (const name of fs.readdirSync(cacheRootDir())) {
    if (!name.endsWith('.meta.json')) continue
    const cacheKey = name.replace(/\.meta\.json$/, '')
    const meta = readMeta(cacheKey)
    if (!meta || !meta.sessionIds.includes(sessionId)) continue
    meta.sessionClosedAt[sessionId] = nowIso
    writeMeta(meta)
  }
}

async function downloadImage(sourceUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: REFERER,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`)
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length <= 0) throw new Error('图片为空')
  return { buffer, contentType }
}

export async function proxyGoodReviewImage(params: {
  rawUrl: string
  sessionId?: string
}): Promise<{ ok: true; file: string; contentType: string } | { ok: false; message: string }> {
  cleanupGoodReviewImageCache()

  const normalized = normalizeProxyImageUrl(params.rawUrl)
  if (!normalized) {
    return { ok: false, message: '不允许的图片地址' }
  }

  const cacheKey = sha1(normalized)
  const existing = readMeta(cacheKey)
  const nowIso = new Date().toISOString()
  if (existing && fs.existsSync(existing.localPath)) {
    existing.lastAccessAt = nowIso
    existing.expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString()
    if (params.sessionId && !existing.sessionIds.includes(params.sessionId)) {
      existing.sessionIds.push(params.sessionId)
    }
    writeMeta(existing)
    return { ok: true, file: existing.localPath, contentType: existing.contentType }
  }

  try {
    const { buffer, contentType } = await downloadImage(normalized)
    ensureCacheDir()
    const ext = extFromContentType(contentType)
    const localPath = filePath(cacheKey, ext)
    fs.writeFileSync(localPath, buffer)
    const meta: GoodReviewImageCacheMeta = {
      cacheKey,
      sourceUrlHash: cacheKey,
      sourceUrl: normalized,
      localPath,
      contentType,
      createdAt: nowIso,
      lastAccessAt: nowIso,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      sessionIds: params.sessionId ? [params.sessionId] : [],
      sessionClosedAt: {},
    }
    writeMeta(meta)
    return { ok: true, file: localPath, contentType }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '下载图片失败' }
  }
}

export function startGoodReviewImageCacheCleanupTimer(): void {
  cleanupGoodReviewImageCache(true)
  setInterval(() => cleanupGoodReviewImageCache(true), CLEANUP_INTERVAL_MS).unref()
}
