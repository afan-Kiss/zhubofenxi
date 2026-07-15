/** 客服聊天消息归一化 / 图片 URL 修补 */

const REFUND_RE = /退[货款]|仅退款|退款|退货|售后申请|申请退/
const AVATAR_RE = /avatar|headimg|head_img|sns-avatar|user-avatar|default_avatar/i

export function normalizeMediaUrl(raw: string | null | undefined): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (s.startsWith('//')) return `https:${s}`
  if (/^https?:\/\//i.test(s)) return s
  return ''
}

function isLikelyAvatarUrl(url: string): boolean {
  const u = url.toLowerCase()
  if (AVATAR_RE.test(u)) return true
  if (/\/avatar[\/.-]|\/avatars[\/.-]/.test(u)) return true
  return false
}

function isPreferredChatImage(url: string): boolean {
  const u = url.toLowerCase()
  if (isLikelyAvatarUrl(u)) return false
  return (
    u.includes('ci.xiaohongshu.com') ||
    u.includes('qimg.xiaohongshu.com') ||
    u.includes('evapic.') ||
    u.includes('arkgoods') ||
    u.includes('rimmatrix')
  )
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function tryParseJson(raw: unknown): unknown {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  const s = String(raw).trim()
  if (!s || (!s.startsWith('{') && !s.startsWith('['))) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function collectSrcUrls(value: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length >= 12 || value == null) return
  if (typeof value === 'string') {
    const u = normalizeMediaUrl(value)
    if (u && !isLikelyAvatarUrl(u)) out.push(u)
    const parsed = tryParseJson(value)
    if (parsed != null && parsed !== value) collectSrcUrls(parsed, out, depth + 1)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSrcUrls(item, out, depth + 1)
    return
  }
  const obj = asRecord(value)
  if (!obj) return
  for (const [key, val] of Object.entries(obj)) {
    if (AVATAR_RE.test(key)) continue
    if (
      /^(src|url|imageUrl|imgUrl|thumbUrl|thumbnailUrl|originUrl|originalUrl|cdnUrl|picUrl|coverUrl|image)$/i.test(
        key,
      )
    ) {
      const u = normalizeMediaUrl(typeof val === 'string' ? val : String(val ?? ''))
      if (u && !isLikelyAvatarUrl(u)) out.push(u)
    }
    collectSrcUrls(val, out, depth + 1)
  }
}

function finalizeImageUrls(urls: string[]): { imageUrls: string[]; thumbUrl: string } {
  const uniq = [...new Set(urls.map((u) => normalizeMediaUrl(u)).filter(Boolean))].filter(
    (u) => !isLikelyAvatarUrl(u),
  )
  const preferred = uniq.filter(isPreferredChatImage)
  const chosen = preferred.length ? preferred : uniq
  return {
    imageUrls: chosen.slice(0, 6),
    thumbUrl: chosen[0] || '',
  }
}

export function extractImageUrlsFromMessage(msg: {
  imageUrls?: unknown
  thumbUrl?: unknown
  contentType?: unknown
  raw?: unknown
}): { imageUrls: string[]; thumbUrl: string } {
  const out: string[] = []
  const push = (u: unknown) => {
    const n = normalizeMediaUrl(typeof u === 'string' ? u : '')
    if (n && !isLikelyAvatarUrl(n)) out.push(n)
  }

  if (Array.isArray(msg.imageUrls)) {
    for (const u of msg.imageUrls) push(u)
  }
  push(msg.thumbUrl)

  if (!out.length || !out.some(isPreferredChatImage)) {
    collectSrcUrls(msg.raw, out)
  }

  return finalizeImageUrls(out)
}

export function sessionIdOf(shopTitle: string, appCid: string): string {
  return `${shopTitle}::${appCid}`
}

export function messageIdOf(shopTitle: string, msgId: string): string {
  return `${shopTitle}::${msgId}`
}

export function textLooksRefund(text: string | null | undefined): boolean {
  return REFUND_RE.test(String(text || ''))
}

export interface NormalizedChatMessage {
  shopTitle: string
  appCid: string
  msgId: string
  buyerNick: string
  contentType: string
  text: string
  imageUrls: string[]
  thumbUrl: string
  senderType: string
  createAt: number | null
}

export function normalizeImportMessage(
  raw: Record<string, unknown>,
  fallbackShop?: string,
): NormalizedChatMessage | null {
  const shopTitle = String(raw.shopTitle || fallbackShop || '').trim()
  const appCid = String(raw.appCid || '').trim()
  const msgId = String(raw.msgId || '').trim()
  if (!shopTitle || !appCid || !msgId) return null

  const { imageUrls, thumbUrl } = extractImageUrlsFromMessage({
    imageUrls: raw.imageUrls,
    thumbUrl: raw.thumbUrl,
    contentType: raw.contentType,
    raw: raw.raw,
  })

  let contentType = String(raw.contentType || 'text').trim() || 'text'
  if (imageUrls.length && (contentType === 'unknown' || contentType === 'text')) {
    if (String(raw.text || '').includes('图片') || raw.isImage === true) {
      contentType = 'image'
    }
  }
  if (imageUrls.length && contentType === 'unknown') contentType = 'image'

  const createAtNum = Number(raw.createAt || 0)
  return {
    shopTitle,
    appCid,
    msgId,
    buyerNick: String(raw.buyerNick || '').trim(),
    contentType,
    text: String(raw.text || raw.summary || '').trim(),
    imageUrls,
    thumbUrl,
    senderType: String(raw.senderType || '').trim().toUpperCase(),
    createAt: Number.isFinite(createAtNum) && createAtNum > 0 ? createAtNum : null,
  }
}
