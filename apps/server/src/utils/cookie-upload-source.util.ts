export type CookieUploadSource = 'manual' | 'api' | 'unknown'

const API_UPLOAD_MARKERS = new Set(['shop-cookie-upload'])

export function resolveCookieUploadSource(
  updatedBy: string | null | undefined,
): CookieUploadSource {
  const key = updatedBy?.trim()
  if (!key) return 'unknown'
  if (API_UPLOAD_MARKERS.has(key)) return 'api'
  return 'manual'
}

export function cookieUploadSourceLabel(source: CookieUploadSource): string {
  switch (source) {
    case 'api':
      return 'API 上传'
    case 'manual':
      return '手动上传'
    default:
      return '—'
  }
}
