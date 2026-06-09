import type { AnalyzedOrderView } from '../types/analysis'

/** 不计入经营总览 / 主播业绩 / 买家排行等核心指标的默认排除名（刷单店 / 新店） */
export const DEFAULT_EXCLUDED_SHOP_NAMES = ['和田雅玉'] as const
export const DEFAULT_EXCLUDED_LIVE_ACCOUNT_NAMES = ['和田雅玉'] as const
export const DEFAULT_EXCLUDED_STORE_NAMES = ['和田雅玉'] as const

export interface MetricsExclusionConfig {
  excludedShopNames: string[]
  excludedLiveAccountNames: string[]
  excludedStoreNames: string[]
}

function normalizeExclusionName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function parseEnvNameList(envKey: string, fallback: readonly string[]): string[] {
  const raw = process.env[envKey]?.trim()
  if (!raw) return [...fallback]
  return raw
    .split(/[,，;；|]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildExclusionSet(names: readonly string[]): Set<string> {
  return new Set(names.map(normalizeExclusionName).filter(Boolean))
}

let cachedConfig: MetricsExclusionConfig | null = null

/** 读取排除配置（支持环境变量覆盖，逗号分隔） */
export function getMetricsExclusionConfig(): MetricsExclusionConfig {
  if (cachedConfig) return cachedConfig
  cachedConfig = {
    excludedShopNames: parseEnvNameList(
      'METRICS_EXCLUDED_SHOP_NAMES',
      DEFAULT_EXCLUDED_SHOP_NAMES,
    ),
    excludedLiveAccountNames: parseEnvNameList(
      'METRICS_EXCLUDED_LIVE_ACCOUNT_NAMES',
      DEFAULT_EXCLUDED_LIVE_ACCOUNT_NAMES,
    ),
    excludedStoreNames: parseEnvNameList(
      'METRICS_EXCLUDED_STORE_NAMES',
      DEFAULT_EXCLUDED_STORE_NAMES,
    ),
  }
  return cachedConfig
}

/** 测试 / 热更新用：清空配置缓存 */
export function resetMetricsExclusionConfigCache(): void {
  cachedConfig = null
}

function pickShopNameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  for (const k of ['shopName', 'shop_name', 'sellerShopName', 'seller_shop_name']) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickStoreNameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  for (const k of ['storeName', 'store_name', 'shopTitle', 'shop_title', 'sellerName']) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function isNameInSet(name: string | null | undefined, set: Set<string>): boolean {
  const n = normalizeExclusionName(name)
  return Boolean(n && set.has(n))
}

/** 订单是否应从核心经营指标中排除（仍保留在原始明细 / 导出中） */
export function isExcludedFromCoreMetrics(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  config: MetricsExclusionConfig = getMetricsExclusionConfig(),
): boolean {
  const liveAccountSet = buildExclusionSet(config.excludedLiveAccountNames)
  const shopSet = buildExclusionSet(config.excludedShopNames)
  const storeSet = buildExclusionSet(config.excludedStoreNames)

  if (isNameInSet(view.liveAccountName, liveAccountSet)) return true

  const shopName = pickShopNameFromRaw(view.raw)
  if (isNameInSet(shopName, shopSet)) return true

  const storeName = pickStoreNameFromRaw(view.raw)
  if (isNameInSet(storeName, storeSet)) return true

  return false
}

export function filterViewsForCoreMetrics<T extends AnalyzedOrderView>(
  views: Array<T & { raw?: Record<string, unknown> }>,
  config?: MetricsExclusionConfig,
): Array<T & { raw?: Record<string, unknown> }> {
  const cfg = config ?? getMetricsExclusionConfig()
  return views.filter((v) => !isExcludedFromCoreMetrics(v, cfg))
}

/** 供导出 / 调试：当前生效的排除名单摘要 */
export function describeMetricsExclusionConfig(): {
  excludedShopNames: string[]
  excludedLiveAccountNames: string[]
  excludedStoreNames: string[]
} {
  const cfg = getMetricsExclusionConfig()
  return {
    excludedShopNames: [...cfg.excludedShopNames],
    excludedLiveAccountNames: [...cfg.excludedLiveAccountNames],
    excludedStoreNames: [...cfg.excludedStoreNames],
  }
}
