import { prisma } from '../../lib/prisma'
import { normalizeMediaUrl } from './cs-chat-normalize'

function parseImageUrls(json: string | null | undefined): string[] {
  try {
    const arr = JSON.parse(json || '[]') as unknown
    if (!Array.isArray(arr)) return []
    return arr.map((u) => normalizeMediaUrl(String(u || ''))).filter(Boolean)
  } catch {
    return []
  }
}

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

export interface CsChatListResult {
  items: CsChatSessionView[]
  total: number
  shops: Array<{ shopTitle: string; sessionCount: number }>
  meta: {
    lastSyncedAt: string | null
    source: string | null
  }
}

function bigIntToNum(v: bigint | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'bigint' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function listCsChatSessions(params: {
  shopTitle?: string
  keyword?: string
  refundOnly?: boolean
  hasImage?: boolean
  limit?: number
  offset?: number
}): Promise<CsChatListResult> {
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200)
  const offset = Math.max(Number(params.offset) || 0, 0)
  const keyword = String(params.keyword || '').trim()

  const where: Record<string, unknown> = {}
  if (params.shopTitle?.trim()) where.shopTitle = params.shopTitle.trim()
  if (params.refundOnly) where.refundMention = true
  if (params.hasImage) where.hasImage = true
  if (keyword) {
    where.OR = [
      { buyerNick: { contains: keyword } },
      { lastMessageText: { contains: keyword } },
      { appCid: { contains: keyword } },
    ]
  }

  const [total, rows, shopGroups, meta] = await Promise.all([
    prisma.csChatSession.count({ where }),
    prisma.csChatSession.findMany({
      where,
      orderBy: [{ modifyTime: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.csChatSession.groupBy({
      by: ['shopTitle'],
      _count: { _all: true },
      orderBy: { shopTitle: 'asc' },
    }),
    prisma.csChatSyncMeta.findUnique({ where: { id: 'default' } }),
  ])

  return {
    items: rows.map((r) => ({
      id: r.id,
      shopTitle: r.shopTitle,
      appCid: r.appCid,
      buyerNick: r.buyerNick || '',
      modifyTime: bigIntToNum(r.modifyTime),
      createAt: bigIntToNum(r.createAt),
      messageCount: r.messageCount,
      lastMessageText: r.lastMessageText || '',
      lastMessageAt: bigIntToNum(r.lastMessageAt),
      hasImage: r.hasImage,
      refundMention: r.refundMention,
    })),
    total,
    shops: shopGroups.map((g) => ({
      shopTitle: g.shopTitle,
      sessionCount: g._count._all,
    })),
    meta: {
      lastSyncedAt: meta?.lastSyncedAt?.toISOString() ?? null,
      source: meta?.source ?? null,
    },
  }
}

export async function getCsChatSessionMessages(sessionId: string): Promise<{
  session: CsChatSessionView | null
  messages: CsChatMessageView[]
}> {
  const session = await prisma.csChatSession.findUnique({ where: { id: sessionId } })
  if (!session) return { session: null, messages: [] }

  const msgs = await prisma.csChatMessage.findMany({
    where: { sessionId },
    orderBy: { createAt: 'asc' },
  })

  return {
    session: {
      id: session.id,
      shopTitle: session.shopTitle,
      appCid: session.appCid,
      buyerNick: session.buyerNick || '',
      modifyTime: bigIntToNum(session.modifyTime),
      createAt: bigIntToNum(session.createAt),
      messageCount: session.messageCount,
      lastMessageText: session.lastMessageText || '',
      lastMessageAt: bigIntToNum(session.lastMessageAt),
      hasImage: session.hasImage,
      refundMention: session.refundMention,
    },
    messages: msgs.map((m) => {
      const imageUrls = parseImageUrls(m.imageUrlsJson)
      const thumbUrl = normalizeMediaUrl(m.thumbUrl || '') || imageUrls[0] || ''
      const senderType = String(m.senderType || '').toUpperCase()
      const isSellerSide =
        senderType === 'SELLER' ||
        senderType === 'MERCHANT' ||
        senderType === 'SYSTEM' ||
        senderType === 'BOT'
      return {
        id: m.id,
        sessionId: m.sessionId,
        shopTitle: m.shopTitle,
        appCid: m.appCid,
        msgId: m.msgId,
        buyerNick: m.buyerNick || '',
        contentType: m.contentType,
        text: m.text || '',
        imageUrls,
        thumbUrl,
        senderType,
        createAt: bigIntToNum(m.createAt),
        isSellerSide,
      }
    }),
  }
}
