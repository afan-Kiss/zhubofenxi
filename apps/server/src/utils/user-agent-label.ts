/** 将 User-Agent 转为管理员可读的环境描述 */
export function formatUserAgentLabel(ua: string | null | undefined): string {
  const raw = ua?.trim()
  if (!raw) return '—'

  let browser = '未知浏览器'
  if (/MicroMessenger/i.test(raw)) browser = '微信内置浏览器'
  else if (/Edg\//i.test(raw)) browser = 'Edge'
  else if (/Firefox\//i.test(raw)) browser = 'Firefox'
  else if (/Chrome\//i.test(raw)) browser = 'Chrome'
  else if (/Safari\//i.test(raw) && !/Chrome/i.test(raw)) browser = 'Safari'

  let os = ''
  if (/iPhone|iPad|iPod/i.test(raw)) os = 'iOS'
  else if (/Android/i.test(raw)) os = 'Android'
  else if (/Windows NT/i.test(raw)) os = 'Windows'
  else if (/Mac OS X/i.test(raw)) os = 'macOS'
  else if (/Linux/i.test(raw)) os = 'Linux'

  return os ? `${browser} · ${os}` : browser
}

export function formatClientInfo(input: {
  ip?: string | null
  userAgent?: string | null
}): string {
  const label = formatUserAgentLabel(input.userAgent)
  const ip = input.ip?.trim()
  if (ip && label !== '—') return `${label}（${ip}）`
  if (ip) return ip
  return label
}
