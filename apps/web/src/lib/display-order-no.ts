/**
 * 前端展示订单号（与后端 order-display-no.service 口径一致）
 * 禁止 Number/parseInt；不优先展示无 P 前缀的纯数字 orderNo。
 */

function toOrderNoString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t || t === 'null' || t === 'undefined') return null
    return t
  }
  if (typeof value === 'bigint') return value.toString()
  return null
}

export function isBareNumericOrderDisplay(value: string): boolean {
  const s = value.trim()
  if (!s || /^P/i.test(s)) return false
  return /^\d{12,}$/.test(s)
}

function scoreCandidate(s: string): number {
  let score = s.length
  if (/^P\d{10,}$/i.test(s)) score += 10_000
  else if (/^P/i.test(s)) score += 5_000
  else if (/^\d+$/.test(s)) score -= 500
  return score
}

/** 从 API 行 / 缓存 JSON 解析展示用订单号 */
export function pickDisplayOrderNoFromRow(raw: Record<string, unknown>): string {
  const orderedKeys = [
    'displayOrderNo',
    'officialOrderNo',
    'packageId',
    'packageNo',
    'orderSn',
    'orderNumber',
    'orderNo',
  ] as const

  const candidates: string[] = []
  for (const key of orderedKeys) {
    const s = toOrderNoString(raw[key])
    if (s) candidates.push(s)
  }

  const nested = raw.raw
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const nestedPick = pickDisplayOrderNoFromRow(nested as Record<string, unknown>)
    if (nestedPick !== '—') candidates.push(nestedPick)
  }

  const withP = candidates.filter((c) => /^P/i.test(c))
  const pool =
    withP.length > 0 ? withP : candidates.filter((c) => !isBareNumericOrderDisplay(c))

  let best = ''
  let bestScore = -1
  for (const c of pool) {
    const sc = scoreCandidate(c)
    if (sc > bestScore) {
      bestScore = sc
      best = c
    }
  }
  return best || '—'
}

export function displayOrderNoForRow(row: {
  orderNo?: string
  displayOrderNo?: string
  officialOrderNo?: string
  packageId?: string
}): string {
  const picked = pickDisplayOrderNoFromRow(row as Record<string, unknown>)
  if (picked !== '—') return picked
  const legacy = toOrderNoString(row.orderNo)
  if (legacy && !isBareNumericOrderDisplay(legacy)) return legacy
  if (legacy && /^P/i.test(legacy)) return legacy
  return '—'
}
