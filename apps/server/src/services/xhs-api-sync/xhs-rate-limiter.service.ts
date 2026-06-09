const DEFAULT_INTERVAL_MS = 1000
const MIN_INTERVAL_MS = 1000

let lastRequestAt = 0
let chain: Promise<void> = Promise.resolve()
let cachedIntervalMs = DEFAULT_INTERVAL_MS
let cacheLoadedAt = 0

async function getIntervalMs(): Promise<number> {
  const now = Date.now()
  if (now - cacheLoadedAt < 30_000) return cachedIntervalMs
  try {
    const { getApiSyncSettings } = await import('../system-setting.service')
    const settings = await getApiSyncSettings()
    cachedIntervalMs = Math.max(MIN_INTERVAL_MS, settings.xhsRequestIntervalMs)
  } catch {
    cachedIntervalMs = DEFAULT_INTERVAL_MS
  }
  cacheLoadedAt = now
  return cachedIntervalMs
}

async function waitForXhsRateLimit(): Promise<void> {
  const intervalMs = await getIntervalMs()
  const now = Date.now()
  const waitMs = Math.max(0, intervalMs - (now - lastRequestAt))
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs))
  }
  lastRequestAt = Date.now()
}

/** 全局串行队列：所有小红书 API 请求依次执行，不允许并发 */
export function enqueueXhsRequest<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    await waitForXhsRateLimit()
    return fn()
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
