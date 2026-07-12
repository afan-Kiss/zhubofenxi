import { prisma } from '../../lib/prisma'

function parseCookieMap(cookie: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(cookie || '').split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

/** Cookie 中的账号 ID 候选（操作员/商家后台） */
export function resolveLuckyGiftHostIdFromCookie(cookie: string): string | null {
  const m = parseCookieMap(cookie)
  const candidates = [
    m['x-user-id-ark.xiaohongshu.com'],
    m['x-user-id'],
    m['customer-sso-user-id'],
    m['walle-eva-bUserId'],
  ]
  for (const c of candidates) {
    const v = String(c || '').trim()
    if (v) return v
  }
  return null
}

function pickLiveMetricValue(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key]
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as Record<string, unknown>)) {
    const text = String((v as Record<string, unknown>).value ?? '').trim()
    return text || null
  }
  if (v == null) return null
  const text = String(v).trim()
  return text || null
}

function isXhsUserId(value: string | null | undefined): value is string {
  const s = String(value || '').trim()
  return /^[0-9a-f]{8,}$/i.test(s)
}

function extractHostIdFromSessionRaw(raw: Record<string, unknown>): string | null {
  const direct = pickLiveMetricValue(raw, 'userId')
  if (isXhsUserId(direct)) return direct
  const userBasic = raw.userBasic
  if (userBasic && typeof userBasic === 'object' && !Array.isArray(userBasic) && 'value' in userBasic) {
    const arr = (userBasic as { value?: unknown }).value
    if (Array.isArray(arr) && arr[0] && typeof arr[0] === 'object') {
      const uid = String((arr[0] as Record<string, unknown>).userId ?? '').trim()
      if (isXhsUserId(uid)) return uid
    }
  }
  return null
}

/** 平台福袋 hostId = 直播号小红书 userId（非 Cookie 操作员 x-user-id） */
export async function resolveLuckyGiftHostIdForAccount(
  liveAccountId: string,
  cookie: string,
): Promise<{ hostId: string; source: 'live_session' | 'cookie' }> {
  const latest = await prisma.xhsRawLiveSession.findFirst({
    where: { liveAccountId },
    orderBy: { startTime: 'desc' },
    select: { rawJson: true },
  })
  if (latest?.rawJson && typeof latest.rawJson === 'object' && !Array.isArray(latest.rawJson)) {
    const hostId = extractHostIdFromSessionRaw(latest.rawJson as Record<string, unknown>)
    if (hostId) return { hostId, source: 'live_session' }
  }
  const anySession = await prisma.xhsRawLiveSession.findFirst({
    where: { liveAccountId },
    orderBy: { createdAt: 'desc' },
    select: { rawJson: true },
  })
  if (anySession?.rawJson && typeof anySession.rawJson === 'object' && !Array.isArray(anySession.rawJson)) {
    const hostId = extractHostIdFromSessionRaw(anySession.rawJson as Record<string, unknown>)
    if (hostId) return { hostId, source: 'live_session' }
  }
  const hostId = resolveLuckyGiftHostIdFromCookie(cookie)
  if (!hostId) throw new Error('无法解析福袋 hostId：缺少直播场次 userId 且 Cookie 无账号 ID')
  return { hostId, source: 'cookie' }
}

/** 历史福袋按场次 room_id 查询；平台实测 liveId 可作为 room_id */
export async function listLuckyGiftRoomIdsForAccount(liveAccountId: string): Promise<string[]> {
  const sessions = await prisma.xhsRawLiveSession.findMany({
    where: { liveAccountId, liveId: { not: null } },
    orderBy: { startTime: 'desc' },
    select: { liveId: true, rawJson: true },
    take: 200,
  })
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of sessions) {
    const candidates = [
      s.liveId,
      s.rawJson && typeof s.rawJson === 'object' && !Array.isArray(s.rawJson)
        ? pickLiveMetricValue(s.rawJson as Record<string, unknown>, 'roomId')
        : null,
      s.rawJson && typeof s.rawJson === 'object' && !Array.isArray(s.rawJson)
        ? pickLiveMetricValue(s.rawJson as Record<string, unknown>, 'room_id')
        : null,
    ]
    for (const c of candidates) {
      const id = String(c || '').trim()
      if (!id || !/^[0-9a-f]{8,}$/i.test(id) || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
