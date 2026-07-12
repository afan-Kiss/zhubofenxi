/**
 * 超长数字 ID 安全解析：避免 JSON.parse 把 18 位 id 变成 Number 丢精度。
 * 例：138008565063504647 → 不能变成 138008565063504640
 */
const BIG_INT_VALUE_RE = /([:\[,]\s*)(-?\d{15,})(\s*[,\}\]])/g

export function quoteLargeJsonIntegers(text: string): string {
  return String(text || '').replace(BIG_INT_VALUE_RE, '$1"$2"$3')
}

export function parseJsonPreserveLargeIds<T = unknown>(text: string): T {
  const safe = quoteLargeJsonIntegers(text)
  return JSON.parse(safe) as T
}

/** 从原始响应文本提取指定字段的数字字符串（不经 Number） */
export function extractRawIdStrings(text: string, field: string): string[] {
  const re = new RegExp(`"${field}"\\s*:\\s*(\\d{10,})`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) {
    if (m[1]) out.push(m[1])
  }
  return out
}

export function asIdString(value: unknown, fallbackRaw?: string | null): string {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 已丢精度的 number 不可信；优先用原文
    if (fallbackRaw && /^\d+$/.test(fallbackRaw)) return fallbackRaw
    return String(Math.trunc(value))
  }
  if (fallbackRaw && /^\d+$/.test(fallbackRaw)) return fallbackRaw
  const s = String(value ?? '').trim()
  return s
}

export function assertIdUnchanged(original: string, after: string, label: string): void {
  if (original !== after) {
    throw new Error(`${label} 精度丢失：${original} → ${after}`)
  }
}
