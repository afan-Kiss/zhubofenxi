/**
 * CMD / 服务端统一日志：带时间戳、中文 scope、分级输出、自动清屏
 */
function formatTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function prefix(scope: string): string {
  return `[${formatTimestamp()}] [${scope}]`
}

function envTruthy(name: string, defaultValue: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  if (v === undefined || v === '') return defaultValue
  if (v === 'false' || v === '0' || v === 'no') return false
  return v === 'true' || v === '1' || v === 'yes'
}

let outputCharCount = 0

export function isVerboseErrorEnabled(): boolean {
  return envTruthy('ENABLE_VERBOSE_ERROR', false)
}

export function isPerfLogEnabled(): boolean {
  return envTruthy('ENABLE_PERF_LOG', false)
}

export function isBoardMetricsDebugEnabled(): boolean {
  const v = process.env.ENABLE_BOARD_METRICS_DEBUG?.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  return process.env.BOARD_METRICS_DEBUG === '1'
}

export function isAccessLogEnabled(): boolean {
  return envTruthy('ENABLE_ACCESS_LOG', true)
}

export function isApiAccessLogEnabled(): boolean {
  return envTruthy('ENABLE_API_ACCESS_LOG', false)
}

export function isStaticAccessLogEnabled(): boolean {
  return envTruthy('ENABLE_STATIC_ACCESS_LOG', false)
}

export function isHealthAccessLogEnabled(): boolean {
  return envTruthy('ENABLE_HEALTH_ACCESS_LOG', false)
}

export function isXhsSignDebugEnabled(): boolean {
  return envTruthy('ENABLE_XHS_SIGN_DEBUG', false)
}

export function isAutoClearLogEnabled(): boolean {
  return envTruthy('ENABLE_AUTO_CLEAR_LOG', true)
}

export function getAutoClearLogChars(): number {
  const n = Number(process.env.AUTO_CLEAR_LOG_CHARS ?? 100_000)
  return Number.isFinite(n) && n > 1000 ? Math.floor(n) : 100_000
}

function trackOutput(line: string): void {
  outputCharCount += line.length + 1
}

function emitLine(stream: 'log' | 'warn' | 'error', line: string): void {
  trackOutput(line)
  maybeAutoClearConsole()
  if (stream === 'warn') console.warn(line)
  else if (stream === 'error') console.error(line)
  else console.log(line)
}

export function maybeAutoClearConsole(): void {
  if (!isAutoClearLogEnabled()) return
  if (outputCharCount < getAutoClearLogChars()) return

  outputCharCount = 0
  try {
    if (process.stdout.isTTY) {
      console.clear()
    } else {
      process.stdout.write('\x1Bc')
    }
  } catch {
    /* ignore */
  }

  const port = Number(process.env.PORT ?? 3001)
  const banner = [
    '==================================================',
    `${prefix('日志')} CMD 日志已超过 ${getAutoClearLogChars()} 字符，系统已自动清屏，避免窗口卡顿。`,
    `${prefix('日志')} 当前服务仍在运行。`,
    `${prefix('日志')} 本机访问：http://127.0.0.1:${port}`,
    `${prefix('日志')} 访问日志：${isAccessLogEnabled() ? '已开启' : '已关闭'}`,
    `${prefix('日志')} 普通 API 日志：${isApiAccessLogEnabled() ? '已开启' : '已关闭'}`,
    `${prefix('日志')} 签名成功日志：${isXhsSignDebugEnabled() ? '已开启' : '已关闭'}`,
    '==================================================',
  ]
  for (const line of banner) {
    trackOutput(line)
    console.log(line)
  }
}

export function logInfo(scope: string, message: string): void {
  emitLine('log', `${prefix(scope)} ${message}`)
}

export function logWarn(scope: string, message: string): void {
  emitLine('warn', `${prefix(scope)} ${message}`)
}

export function logError(scope: string, message: string, error?: unknown): void {
  emitLine('error', `${prefix(scope)} ${message}`)
  if (error != null && isVerboseErrorEnabled()) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    emitLine('error', detail)
  }
}

export function logDebug(scope: string, message: string, enabled = true): void {
  if (!enabled) return
  emitLine('log', `${prefix(scope)} ${message}`)
}

/** 经营缓存 preset 中文标签 */
export function presetLabel(preset: string): string {
  switch (preset) {
    case 'today':
      return '今日'
    case 'yesterday':
      return '昨日'
    case 'thisWeek':
      return '本周'
    case 'thisMonth':
      return '本月'
    case 'lastMonth':
      return '上月'
    default:
      return preset
  }
}

/** 启动汇总用：各日志开关状态行 */
export function buildLogSwitchStatusLines(): string[] {
  return [
    `访问日志：${isAccessLogEnabled() ? '已开启' : '已关闭'}`,
    `普通 API 日志：${isApiAccessLogEnabled() ? '已开启' : '已关闭'}`,
    `静态资源日志：${isStaticAccessLogEnabled() ? '已开启' : '已关闭'}`,
    `健康检查日志：${isHealthAccessLogEnabled() ? '已开启' : '已关闭'}`,
    `签名成功日志：${isXhsSignDebugEnabled() ? '已开启' : '已关闭'}`,
    `详细指标日志：${isBoardMetricsDebugEnabled() ? '已开启' : '已关闭'}`,
    `性能日志：${isPerfLogEnabled() ? '已开启' : '已关闭'}`,
    `自动清屏：${isAutoClearLogEnabled() ? '已开启' : '已关闭'}，阈值 ${getAutoClearLogChars()} 字符`,
  ]
}



