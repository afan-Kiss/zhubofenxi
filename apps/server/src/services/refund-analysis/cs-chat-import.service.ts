import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDataDir, SERVER_ROOT } from '../../config/env'
import { prisma } from '../../lib/prisma'
import {
  messageIdOf,
  normalizeImportMessage,
  sessionIdOf,
  textLooksRefund,
  type NormalizedChatMessage,
} from './cs-chat-normalize'

const BATCH = 200

export interface ImportArchiveResult {
  ok: boolean
  sourcePath: string
  sessionCount: number
  messageCount: number
  shopCounts: Record<string, { sessions: number; messages: number }>
  error?: string
}

function defaultArchiveCandidates(): string[] {
  const home = os.homedir()
  const desktop = path.join(home, 'Desktop')
  const out: string[] = []
  if (process.env.CS_CHAT_ARCHIVE_PATH?.trim()) {
    out.push(process.env.CS_CHAT_ARCHIVE_PATH.trim())
  }
  out.push(path.join(getDataDir(), 'cs-chat-archive.json'))
  out.push(path.join(SERVER_ROOT, 'data', 'cs-chat-archive.json'))
  try {
    const files = fs.readdirSync(desktop)
    const matched = files
      .filter((f) => /^千帆近\d+天-四店全部-.*\.json$/i.test(f) || /^千帆聊天记录-全部-.*\.json$/i.test(f))
      .map((f) => path.join(desktop, f))
      .sort()
      .reverse()
    out.push(...matched)
  } catch {
    /* desktop missing */
  }
  return out
}

export function resolveArchivePath(explicit?: string): string | null {
  if (explicit?.trim() && fs.existsSync(explicit.trim())) return explicit.trim()
  for (const p of defaultArchiveCandidates()) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function upsertMessages(messages: NormalizedChatMessage[]): Promise<void> {
  for (const group of chunk(messages, BATCH)) {
    await prisma.$transaction(
      group.map((m) =>
        prisma.csChatMessage.upsert({
          where: { shopTitle_msgId: { shopTitle: m.shopTitle, msgId: m.msgId } },
          create: {
            id: messageIdOf(m.shopTitle, m.msgId),
            sessionId: sessionIdOf(m.shopTitle, m.appCid),
            shopTitle: m.shopTitle,
            appCid: m.appCid,
            msgId: m.msgId,
            buyerNick: m.buyerNick || null,
            contentType: m.contentType,
            text: m.text || null,
            imageUrlsJson: JSON.stringify(m.imageUrls),
            thumbUrl: m.thumbUrl || null,
            senderType: m.senderType || null,
            createAt: m.createAt != null ? BigInt(m.createAt) : null,
          },
          update: {
            sessionId: sessionIdOf(m.shopTitle, m.appCid),
            appCid: m.appCid,
            buyerNick: m.buyerNick || null,
            contentType: m.contentType,
            text: m.text || null,
            imageUrlsJson: JSON.stringify(m.imageUrls),
            thumbUrl: m.thumbUrl || null,
            senderType: m.senderType || null,
            createAt: m.createAt != null ? BigInt(m.createAt) : null,
            syncedAt: new Date(),
          },
        }),
      ),
    )
  }
}

async function rebuildSessionsFromNormalized(messages: NormalizedChatMessage[]): Promise<number> {
  const bySession = new Map<string, NormalizedChatMessage[]>()
  for (const m of messages) {
    const key = sessionIdOf(m.shopTitle, m.appCid)
    const list = bySession.get(key)
    if (list) list.push(m)
    else bySession.set(key, [m])
  }

  const rows = [...bySession.entries()].map(([sessionId, msgs]) => {
    msgs.sort((a, b) => Number(a.createAt || 0) - Number(b.createAt || 0))
    const last = msgs[msgs.length - 1]
    const buyerNick = [...msgs].reverse().find((m) => m.buyerNick)?.buyerNick || ''
    const hasImage = msgs.some((m) => m.contentType === 'image' || m.imageUrls.length > 0)
    const refundMention = msgs.some((m) => textLooksRefund(m.text))
    const lastAt = last?.createAt ?? null
    const firstAt = msgs[0]?.createAt ?? null
    return {
      sessionId,
      shopTitle: msgs[0]!.shopTitle,
      appCid: msgs[0]!.appCid,
      buyerNick,
      hasImage,
      refundMention,
      lastAt,
      firstAt,
      messageCount: msgs.length,
      lastText: (last?.text || '').slice(0, 200),
    }
  })

  for (const group of chunk(rows, BATCH)) {
    await prisma.$transaction(
      group.map((r) =>
        prisma.csChatSession.upsert({
          where: { shopTitle_appCid: { shopTitle: r.shopTitle, appCid: r.appCid } },
          create: {
            id: r.sessionId,
            shopTitle: r.shopTitle,
            appCid: r.appCid,
            buyerNick: r.buyerNick || null,
            modifyTime: r.lastAt != null ? BigInt(r.lastAt) : null,
            createAt: r.firstAt != null ? BigInt(r.firstAt) : null,
            messageCount: r.messageCount,
            lastMessageText: r.lastText || null,
            lastMessageAt: r.lastAt != null ? BigInt(r.lastAt) : null,
            hasImage: r.hasImage,
            refundMention: r.refundMention,
          },
          update: {
            buyerNick: r.buyerNick || null,
            modifyTime: r.lastAt != null ? BigInt(r.lastAt) : null,
            messageCount: r.messageCount,
            lastMessageText: r.lastText || null,
            lastMessageAt: r.lastAt != null ? BigInt(r.lastAt) : null,
            hasImage: r.hasImage,
            refundMention: r.refundMention,
            syncedAt: new Date(),
          },
        }),
      ),
    )
  }
  return rows.length
}

export async function importCsChatArchiveFromPath(
  archivePath: string,
): Promise<ImportArchiveResult> {
  if (!fs.existsSync(archivePath)) {
    return {
      ok: false,
      sourcePath: archivePath,
      sessionCount: 0,
      messageCount: 0,
      shopCounts: {},
      error: '档案文件不存在',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(archivePath, 'utf8'))
  } catch (err) {
    return {
      ok: false,
      sourcePath: archivePath,
      sessionCount: 0,
      messageCount: 0,
      shopCounts: {},
      error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const rawMessages = Array.isArray(root.messages)
    ? (root.messages as Record<string, unknown>[])
    : Array.isArray(parsed)
      ? (parsed as Record<string, unknown>[])
      : []

  const normalized: NormalizedChatMessage[] = []
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object') continue
    const m = normalizeImportMessage(raw as Record<string, unknown>)
    if (m) normalized.push(m)
  }

  if (!normalized.length) {
    return {
      ok: false,
      sourcePath: archivePath,
      sessionCount: 0,
      messageCount: 0,
      shopCounts: {},
      error: '档案中没有可用消息',
    }
  }

  await upsertMessages(normalized)
  const sessionCount = await rebuildSessionsFromNormalized(normalized)
  const shops = [...new Set(normalized.map((m) => m.shopTitle))]

  const shopCounts: Record<string, { sessions: number; messages: number }> = {}
  for (const shop of shops) {
    const messages = normalized.filter((m) => m.shopTitle === shop).length
    const sessions = new Set(
      normalized.filter((m) => m.shopTitle === shop).map((m) => m.appCid),
    ).size
    shopCounts[shop] = { sessions, messages }
  }

  await prisma.csChatSyncMeta.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      lastSyncedAt: new Date(),
      source: `archive:${archivePath}`,
      summaryJson: JSON.stringify({ sessionCount, messageCount: normalized.length, shopCounts }),
    },
    update: {
      lastSyncedAt: new Date(),
      source: `archive:${archivePath}`,
      summaryJson: JSON.stringify({ sessionCount, messageCount: normalized.length, shopCounts }),
    },
  })

  return {
    ok: true,
    sourcePath: archivePath,
    sessionCount,
    messageCount: normalized.length,
    shopCounts,
  }
}

export async function importLatestCsChatArchive(
  explicitPath?: string,
): Promise<ImportArchiveResult> {
  const p = resolveArchivePath(explicitPath)
  if (!p) {
    return {
      ok: false,
      sourcePath: '',
      sessionCount: 0,
      messageCount: 0,
      shopCounts: {},
      error:
        '未找到会话档案。请把导出的「千帆近60天-四店全部-*.json」放到桌面，或设置 CS_CHAT_ARCHIVE_PATH',
    }
  }
  return importCsChatArchiveFromPath(p)
}
