export type CookieUploadSource = 'manual' | 'api' | 'unknown'

/** 历史批量 API 写入（POST /api/shop-cookies，已默认关闭） */
const LEGACY_API_MARKERS = new Set(['shop-cookie-upload', 'api:shop-cookie-upload'])

const CUID_LIKE = /^c[a-z0-9]{20,}$/i

/** 系统设置页手动粘贴 Cookie 时写入 updatedBy */
export function formatSettingsCookieUpdatedBy(userId: string): string {
  const id = userId.trim()
  if (!id) return 'manual:settings'
  if (id.startsWith('manual:')) return id
  return `manual:settings:${id}`
}

export function resolveCookieUploadSource(
  updatedBy: string | null | undefined,
): CookieUploadSource {
  const key = updatedBy?.trim()
  if (!key) return 'unknown'
  if (key.startsWith('manual:')) return 'manual'
  if (key.startsWith('api:') || LEGACY_API_MARKERS.has(key)) return 'api'
  // 兼容旧版：设置页曾直接写用户 cuid
  if (CUID_LIKE.test(key)) return 'manual'
  // 验收脚本等非 API 批量写入
  if (key.startsWith('verify-') || key === 'verify-script' || key === 'verify-script-manual') {
    return 'manual'
  }
  return 'unknown'
}

export function cookieUploadSourceLabel(source: CookieUploadSource | undefined): string {
  switch (source) {
    case 'api':
      return '历史自动写入'
    case 'manual':
      return '系统设置粘贴'
    default:
      return '—'
  }
}

export function cookieUploadSourceHint(source: CookieUploadSource | undefined): string | null {
  if (source === 'api') {
    return '该 Cookie 曾由外部 API 写入；在下方重新粘贴并保存后，来源会变为「系统设置粘贴」。'
  }
  return null
}
