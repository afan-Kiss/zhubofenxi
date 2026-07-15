import { apiRequest } from './api'

export interface CsChatSessionView {
  id: string
  shopTitle: string
  appCid: string
  buyerNick: string
  modifyTime: number | null
  createAt: number | null
  messageCount: number
  lastMessageText: string
  lastMessageAt: number | null
  hasImage: boolean
  refundMention: boolean
}

export interface CsChatMessageView {
  id: string
  sessionId: string
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
  isSellerSide: boolean
}

export interface CsChatListPayload {
  items: CsChatSessionView[]
  total: number
  shops: Array<{ shopTitle: string; sessionCount: number }>
  meta: {
    lastSyncedAt: string | null
    source: string | null
  }
}

export interface CsChatDetailPayload {
  session: CsChatSessionView
  messages: CsChatMessageView[]
}

export interface CsChatSyncResult {
  ok: boolean
  mode: string
  message: string
  archivePath?: string
  sessionCount: number
  messageCount: number
  shopCounts: Record<string, { sessions: number; messages: number }>
}

export function formatChatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    })
  } catch {
    return '—'
  }
}

export function buildCsChatSessionsUrl(params: {
  shop?: string
  keyword?: string
  refundOnly?: boolean
  hasImage?: boolean
  limit?: number
  offset?: number
}): string {
  const q = new URLSearchParams()
  if (params.shop) q.set('shop', params.shop)
  if (params.keyword) q.set('keyword', params.keyword)
  if (params.refundOnly) q.set('refundOnly', '1')
  if (params.hasImage) q.set('hasImage', '1')
  q.set('limit', String(params.limit ?? 50))
  q.set('offset', String(params.offset ?? 0))
  return `/api/refund-analysis/sessions?${q.toString()}`
}

export async function fetchCsChatSessions(
  params: Parameters<typeof buildCsChatSessionsUrl>[0],
): Promise<CsChatListPayload> {
  return apiRequest<CsChatListPayload>(buildCsChatSessionsUrl(params))
}

export async function fetchCsChatSessionDetail(sessionId: string): Promise<CsChatDetailPayload> {
  return apiRequest<CsChatDetailPayload>(
    `/api/refund-analysis/sessions/${encodeURIComponent(sessionId)}`,
  )
}

export async function syncCsChatSessions(body?: {
  days?: number
  preferLive?: boolean
}): Promise<CsChatSyncResult> {
  return apiRequest<CsChatSyncResult>('/api/refund-analysis/sync', {
    method: 'POST',
    body: JSON.stringify(body ?? { days: 60, preferLive: false }),
    headers: { 'Content-Type': 'application/json' },
  })
}

export function buildCsChatImageProxyUrl(rawUrl: string, sessionId?: string | null): string {
  const params = new URLSearchParams()
  params.set('url', rawUrl)
  if (sessionId) params.set('sessionId', sessionId)
  return `/api/refund-analysis/image-proxy?${params.toString()}`
}
