/** 脱敏 URL：仅保留 origin + pathname，去掉 query 签名参数 */

export function sanitizeUrlForLog(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    const q = url.indexOf('?')
    return q >= 0 ? url.slice(0, q) : url.slice(0, 120)
  }
}

export function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const forbidden = /cookie|password|secret|encryption|token|authorization/i

  for (const [key, value] of Object.entries(meta)) {
    if (forbidden.test(key)) continue
    if (typeof value === 'string' && forbidden.test(value)) continue
    if (key === 'url' && typeof value === 'string') {
      out.url = sanitizeUrlForLog(value)
      continue
    }
    if (key === 'fileUrl' && typeof value === 'string') {
      out.fileUrl = sanitizeUrlForLog(value)
      continue
    }
    out[key] = value
  }
  return out
}
