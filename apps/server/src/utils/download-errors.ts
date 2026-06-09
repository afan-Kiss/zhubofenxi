import type { DownloadType } from '../types/download'
import { COOKIE_EXPIRED_HINT, SIGN_FAILURE_HINT } from './xhs-error'

const COOKIE_NOT_CONFIGURED = '请先在系统设置保存小红书 Cookie。'
const COOKIE_INVALID = COOKIE_EXPIRED_HINT
const ORDER_TIMEOUT = '订单表导出超时，请稍后重试。'
const LIVE_SIGNATURE =
  '直播场次导出可能需要小红书签名参数，请重新抓包或切换临时链接下载。'
const SETTLED_TIMEOUT = '已结算订单明细导出超时，请稍后到小红书后台历史报表查看。'
const PENDING_TIMEOUT = '待结算订单明细导出超时，请稍后到小红书后台历史报表查看。'
const NOT_EXCEL = '下载结果不是 Excel，可能 Cookie 失效或下载链接错误。'

function includesAny(text: string, parts: string[]): boolean {
  const lower = text.toLowerCase()
  return parts.some((p) => lower.includes(p.toLowerCase()))
}

export function normalizeDownloadError(
  err: unknown,
  type?: DownloadType,
): string {
  const raw = err instanceof Error ? err.message : String(err ?? '下载失败')
  const lower = raw.toLowerCase()

  if (
    includesAny(raw, ['尚未配置', 'cookie 未配置', '请先在系统设置保存']) ||
    lower.includes('cookie') && lower.includes('未配置')
  ) {
    return COOKIE_NOT_CONFIGURED
  }

  if (
    includesAny(raw, ['cookie 失效', '可能 cookie 失效', '鉴权失败', 'login']) ||
    (lower.includes('html') && lower.includes('cookie'))
  ) {
    return COOKIE_INVALID
  }

  if (includesAny(raw, ['文件过大', '超过', 'max_download'])) {
    const maxMatch = /(\d+)\s*MB/.exec(raw)
    if (maxMatch) {
      return `下载文件超过大小限制，请调整 MAX_DOWNLOAD_SIZE_MB（当前限制约 ${maxMatch[1]}MB）。`
    }
    return '下载文件超过大小限制，请调整 MAX_DOWNLOAD_SIZE_MB。'
  }

  if (includesAny(raw, ['不是 excel', '不是 Excel', 'spreadsheet'])) {
    return NOT_EXCEL
  }

  if (type === 'order' && includesAny(raw, ['导出超时', '超时'])) {
    return ORDER_TIMEOUT
  }

  if (includesAny(raw, ['签名模块', 'xhshow', '缺少 a1', 'access-token-ark'])) {
    return SIGN_FAILURE_HINT.split('\n')[0]!
  }

  if (includesAny(raw, [SIGN_FAILURE_HINT.split('\n')[0]!])) {
    return SIGN_FAILURE_HINT
  }

  if (type === 'live' && includesAny(raw, ['签名', 'sign', 'x-s-common', '直播场次导出接口'])) {
    return LIVE_SIGNATURE
  }

  if (type === 'settledSettlement' && includesAny(raw, ['已结算', '结算']) && includesAny(raw, ['超时'])) {
    return SETTLED_TIMEOUT
  }

  if (type === 'pendingSettlement' && includesAny(raw, ['待结算', '超时'])) {
    return PENDING_TIMEOUT
  }

  if (includesAny(raw, ['导出超时', '请稍后重试'])) {
    if (type === 'live') return LIVE_SIGNATURE
    if (type === 'settledSettlement') return SETTLED_TIMEOUT
    if (type === 'pendingSettlement') return PENDING_TIMEOUT
    if (type === 'order') return ORDER_TIMEOUT
  }

  if (includesAny(raw, ['结算导出接口', '待结算导出接口']) && includesAny(raw, ['签名', 'sign'])) {
    return type === 'pendingSettlement'
      ? '小红书待结算导出接口可能需要前端签名参数，请重新抓包或改用临时链接下载模式。'
      : '小红书结算导出接口可能需要前端签名参数，请重新抓包或改用手动下载模式。'
  }

  return raw
}
