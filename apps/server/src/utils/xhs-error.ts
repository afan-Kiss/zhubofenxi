const SIGN_FAILURE_HINT = `小红书接口签名失败，请检查：
1. Cookie 是否完整。
2. Cookie 是否包含 a1。
3. Cookie 是否包含 access-token-ark.xiaohongshu.com。
4. Python 依赖 xhshow 是否已安装。
5. 当前账号是否仍登录小红书后台。`

const COOKIE_EXPIRED_HINT =
  '小红书登录状态可能已失效，请重新复制 Cookie。'

const RISK_HINT =
  '小红书接口可能需要更新签名参数，请重新抓包或临时切换链接下载模式。'

export function isXhsSignRelatedMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('签名') ||
    lower.includes('sign') ||
    lower.includes('x-s-common') ||
    lower.includes('xhshow') ||
    lower.includes('签名模块') ||
    lower.includes('缺少 a1') ||
    lower.includes('access-token-ark')
  )
}

export function formatXhsApiError(status: number, bodyText: string): string {
  const lower = bodyText.toLowerCase()
  if (status === 401 || status === 403) {
    return COOKIE_EXPIRED_HINT
  }
  if (
    isXhsSignRelatedMessage(bodyText) ||
    lower.includes('风控') ||
    lower.includes('risk') ||
    lower.includes('verify')
  ) {
    if (status === 401 || status === 403) {
      return COOKIE_EXPIRED_HINT
    }
    return `${SIGN_FAILURE_HINT}\n${RISK_HINT}`
  }
  if (isXhsSignRelatedMessage(bodyText)) {
    return SIGN_FAILURE_HINT
  }
  return `小红书接口请求失败 HTTP ${status}`
}

export function formatXhsSignBridgeError(message: string): string {
  if (message.includes('缺少 a1')) {
    return 'Cookie 缺少 a1，请从已登录的小红书商家后台重新复制完整 Cookie。'
  }
  if (message.includes('access-token-ark')) {
    return 'Cookie 缺少 access-token-ark.xiaohongshu.com，请重新登录商家后台后复制 Cookie。'
  }
  if (
    message.includes('签名模块不可用') ||
    message.includes('xhshow') ||
    message.includes('Python 缺少') ||
    message.includes('未找到可用 Python') ||
    message.includes('脚本不存在') ||
    message.includes('ModuleNotFound') ||
    message.includes('codec') ||
    message.includes('surrogates')
  ) {
    return message
  }
  if (message.includes('（') && isXhsSignRelatedMessage(message)) {
    return message
  }
  if (isXhsSignRelatedMessage(message)) {
    return SIGN_FAILURE_HINT
  }
  return message
}

export { SIGN_FAILURE_HINT, COOKIE_EXPIRED_HINT, RISK_HINT }
