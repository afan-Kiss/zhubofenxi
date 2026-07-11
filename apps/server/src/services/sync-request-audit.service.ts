import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { BUSINESS_SYNC_INTERVAL_MS } from '../config/business-sync.constants'
import { getDataDir } from '../config/env'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import type { RequestXhsJsonOptions } from './xhs-http.service'
import { requestXhsJson } from './xhs-http.service'
import { logWarn } from '../utils/server-log'

export type SyncRequestTrigger = 'manual' | 'scheduled' | 'page_open' | 'retry' | 'unknown'
export type SyncRequestStatus =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'throttled'
  | 'circuit_open'

export interface SyncRequestAuditItem {
  shopId?: string
  shopName?: string
  source: 'xhs'
  apiName: string
  method: string
  urlKey: string
  requestHash: string
  /** 老板看板等按店铺+凭证隔离冷却；旧记录无此字段 */
  cooldownScopeKey?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  status: SyncRequestStatus
  httpStatus?: number
  itemCount?: number
  pageNo?: number
  errorMessage?: string
  trigger: SyncRequestTrigger
}

/** 老板看板冷却键版本：与旧全局 requestHash 隔离 */
export const BOSS_COOLDOWN_VERSION = 'boss-cooldown-v2'

export interface SyncRiskStatus {
  status: 'pass' | 'warning' | 'danger'
  requestCount24h: number
  throttledCount24h: number
  failedCount24h: number
  circuitOpenCount24h: number
  highRiskApis: string[]
  directRequestFindings: Array<{
    file: string
    line: number
    risk: 'low' | 'medium' | 'high'
    reason: string
    suggestion: string
  }>
  jsonlReadWarning?: string
  note: string
}

const COOLDOWN_MS_BY_API: Record<string, number> = {
  order_list: 5 * 60 * 1000,
  order_detail: 10 * 60 * 1000,
  live_session_list: 30 * 60 * 1000,
  live_overview: 30 * 60 * 1000,
  live_traffic_core: 30 * 60 * 1000,
  pending_settlement_list: 30 * 60 * 1000,
  settled_settlement_list: 30 * 60 * 1000,
  settlement_detail: 30 * 60 * 1000,
  boss_account_summary: 30 * 60 * 1000,
  boss_after_sale_frozen: 30 * 60 * 1000,
  boss_account_flow: 30 * 60 * 1000,
  boss_withdraw_flow: 30 * 60 * 1000,
  boss_shop_score: BUSINESS_SYNC_INTERVAL_MS - 10 * 60 * 1000,
  boss_score_rule: BUSINESS_SYNC_INTERVAL_MS - 10 * 60 * 1000,
}

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000
const CIRCUIT_FAIL_THRESHOLD = 5
const CIRCUIT_OPEN_MS = 60 * 60 * 1000

const lastRequestAt = new Map<string, number>()
const failureState = new Map<string, { fails: number; lastFailAt: number; circuitOpenUntil?: number }>()
const recentAuditBuffer: SyncRequestAuditItem[] = []

function auditKey(
  shopId: string | undefined,
  apiName: string,
  requestHash: string,
  cooldownScopeKey?: string,
): string {
  const scope = cooldownScopeKey ?? (shopId ?? 'default')
  return `${scope}::${apiName}::${requestHash}`
}

function failureKey(shopId: string | undefined, apiName: string): string {
  return `${shopId ?? 'default'}::${apiName}`
}

export function buildXhsRequestHash(input: {
  apiName: string
  query?: Record<string, string>
  body?: unknown
}): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ apiName: input.apiName, query: input.query ?? {}, body: input.body ?? null }))
    .digest('hex')
    .slice(0, 16)
}

export function buildBossCooldownScopeKey(shopKey: string, credentialId: string): string {
  return `boss:${shopKey}:${credentialId}`
}

function normalizeBossUrlPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split('?')[0] ?? url
  }
}

/** 老板接口冷却 hash：按店铺+凭证+方法+路径+请求体隔离 */
export function buildBossRequestHash(input: {
  apiName: string
  shopKey: string
  credentialId: string
  method: string
  url: string
  body?: unknown
}): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        v: BOSS_COOLDOWN_VERSION,
        apiName: input.apiName,
        shopKey: input.shopKey,
        credentialId: input.credentialId,
        method: input.method.toUpperCase(),
        path: normalizeBossUrlPath(input.url),
        body: input.body ?? null,
      }),
    )
    .digest('hex')
    .slice(0, 16)
}

export function resolveApiCooldownMs(apiName: string): number {
  return COOLDOWN_MS_BY_API[apiName] ?? DEFAULT_COOLDOWN_MS
}

export type XhsRequestDecision = 'allowed' | 'throttled' | 'circuit_open'

const JSONL_COOLDOWN_CACHE_MS = 30_000
let jsonlCooldownCache: { loadedAt: number; items: SyncRequestAuditItem[] } | null = null

export function checkXhsRequestAllowed(params: {
  shopId?: string
  apiName: string
  requestHash: string
  trigger?: SyncRequestTrigger
  cooldownOverrideMs?: number
  cooldownScopeKey?: string
}): { allowed: boolean; status: SyncRequestStatus; decision: XhsRequestDecision; reason?: string } {
  if (params.trigger === 'page_open') {
    return {
      allowed: false,
      status: 'throttled',
      decision: 'throttled',
      reason: '页面接口禁止直接请求小红书，请使用本地缓存或受控同步任务',
    }
  }

  const fKey = failureKey(params.shopId, params.apiName)
  const fState = failureState.get(fKey)
  const now = Date.now()
  if (fState?.circuitOpenUntil && fState.circuitOpenUntil > now) {
    return {
      allowed: false,
      status: 'circuit_open',
      decision: 'circuit_open',
      reason: '接口熔断中，请稍后再试',
    }
  }

  const key = auditKey(params.shopId, params.apiName, params.requestHash, params.cooldownScopeKey)
  const last = lastRequestAt.get(key)
  const cooldown = params.cooldownOverrideMs ?? resolveApiCooldownMs(params.apiName)
  if (last != null && now - last < cooldown) {
    return {
      allowed: false,
      status: 'throttled',
      decision: 'throttled',
      reason: `冷却中（${Math.ceil((cooldown - (now - last)) / 1000)}s）`,
    }
  }

  return { allowed: true, status: 'success', decision: 'allowed' }
}

function findLastRemoteRequestAt(
  items: SyncRequestAuditItem[],
  shopId: string | undefined,
  apiName: string,
  requestHash: string,
  cooldownScopeKey?: string,
): number | null {
  const scope = cooldownScopeKey ?? (shopId ?? 'default')
  const successOnly = cooldownScopeKey != null
  let latest = 0
  for (const item of items) {
    if (item.apiName !== apiName || item.requestHash !== requestHash) continue
    if (cooldownScopeKey) {
      if (item.cooldownScopeKey !== cooldownScopeKey) continue
    } else if ((item.shopId ?? 'default') !== scope) {
      continue
    }
    if (successOnly) {
      if (item.status !== 'success') continue
    } else if (item.status !== 'success' && item.status !== 'failed') {
      continue
    }
    const t = Date.parse(item.finishedAt ?? item.startedAt)
    if (Number.isFinite(t) && t > latest) latest = t
  }
  return latest > 0 ? latest : null
}

async function loadJsonlItemsForCooldown(): Promise<SyncRequestAuditItem[]> {
  const now = Date.now()
  if (jsonlCooldownCache && now - jsonlCooldownCache.loadedAt < JSONL_COOLDOWN_CACHE_MS) {
    return jsonlCooldownCache.items
  }
  const sinceMs = now - 24 * 60 * 60 * 1000
  try {
    const items = await loadRecentAuditItemsFromJsonl(sinceMs)
    jsonlCooldownCache = { loadedAt: now, items }
    return items
  } catch {
    return jsonlCooldownCache?.items ?? []
  }
}

/** 含 JSONL 冷却恢复：内存未命中时读今天/昨天 JSONL */
export async function checkXhsRequestAllowedWithJsonlCooldown(params: {
  shopId?: string
  apiName: string
  requestHash: string
  trigger?: SyncRequestTrigger
  cooldownOverrideMs?: number
  cooldownScopeKey?: string
}): Promise<{ allowed: boolean; status: SyncRequestStatus; decision: XhsRequestDecision; reason?: string }> {
  const memory = checkXhsRequestAllowed(params)
  if (!memory.allowed) return memory

  const cooldown = params.cooldownOverrideMs ?? resolveApiCooldownMs(params.apiName)
  const items = await loadJsonlItemsForCooldown()
  const lastRemote = findLastRemoteRequestAt(
    items,
    params.shopId,
    params.apiName,
    params.requestHash,
    params.cooldownScopeKey,
  )
  if (lastRemote != null) {
    const elapsed = Date.now() - lastRemote
    if (elapsed < cooldown) {
      return {
        allowed: false,
        status: 'throttled',
        decision: 'throttled',
        reason: `冷却中（JSONL 恢复，${Math.ceil((cooldown - elapsed) / 1000)}s）`,
      }
    }
  }

  return memory
}

export async function appendSyncRequestAudit(item: SyncRequestAuditItem): Promise<void> {
  recentAuditBuffer.push(item)
  if (recentAuditBuffer.length > 5000) recentAuditBuffer.splice(0, recentAuditBuffer.length - 5000)

  const day = formatDateKeyShanghai(new Date(item.startedAt))
  const dir = path.join(getDataDir(), 'sync-request-audit')
  await fs.mkdir(dir, { recursive: true })
  await fs.appendFile(path.join(dir, `${day}.jsonl`), `${JSON.stringify(item)}\n`, 'utf8')
}

function auditDedupeKey(item: SyncRequestAuditItem): string {
  return `${item.startedAt}::${item.apiName}::${item.requestHash}::${item.status}::${item.trigger}`
}

async function loadRecentAuditItemsFromJsonl(sinceMs: number): Promise<SyncRequestAuditItem[]> {
  const dir = path.join(getDataDir(), 'sync-request-audit')
  const now = new Date()
  const dayKeys = [
    formatDateKeyShanghai(now),
    formatDateKeyShanghai(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
  ]
  const seen = new Set<string>()
  const items: SyncRequestAuditItem[] = []

  for (const day of [...new Set(dayKeys)]) {
    const filePath = path.join(dir, `${day}.jsonl`)
    let raw = ''
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      continue
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const item = JSON.parse(trimmed) as SyncRequestAuditItem
        if (Date.parse(item.startedAt) < sinceMs) continue
        const key = auditDedupeKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        items.push(item)
      } catch {
        /* skip malformed line */
      }
    }
  }
  return items
}

function mergeAuditItems(
  jsonlItems: SyncRequestAuditItem[],
  bufferItems: SyncRequestAuditItem[],
): SyncRequestAuditItem[] {
  const seen = new Set<string>()
  const merged: SyncRequestAuditItem[] = []
  for (const item of [...jsonlItems, ...bufferItems]) {
    const key = auditDedupeKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

/** 非 xhs-api-client 路径应使用此函数，统一审计与冷却 */
export async function requestXhsJsonWithSyncAudit<T>(params: {
  shopId?: string
  shopName?: string
  apiName: string
  method: string
  urlKey: string
  trigger?: SyncRequestTrigger
  requestHash?: string
  pageNo?: number
  cooldownOverrideMs?: number
  cooldownScopeKey?: string
  options: RequestXhsJsonOptions
}): Promise<T> {
  const requestHash =
    params.requestHash ??
    buildXhsRequestHash({
      apiName: params.apiName,
      body: params.options.body,
    })
  const result = await runXhsRequestWithAuditAndThrottle<T>({
    shopId: params.shopId,
    shopName: params.shopName,
    apiName: params.apiName,
    method: params.method,
    urlKey: params.urlKey,
    requestHash,
    trigger: params.trigger ?? 'scheduled',
    pageNo: params.pageNo,
    cooldownOverrideMs: params.cooldownOverrideMs,
    cooldownScopeKey: params.cooldownScopeKey,
    execute: async () => {
      try {
        const data = await requestXhsJson<T>(params.options)
        return { ok: true, data, errorMessage: null }
      } catch (err) {
        return {
          ok: false,
          data: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        }
      }
    },
  })
  if (!result.ok || result.data == null) {
    throw new Error(result.errorMessage ?? '小红书接口请求失败')
  }
  return result.data
}

function recordFailure(shopId: string | undefined, apiName: string): void {
  const key = failureKey(shopId, apiName)
  const now = Date.now()
  const prev = failureState.get(key) ?? { fails: 0, lastFailAt: now }
  const backoffOk =
    prev.fails === 0 ||
    (prev.fails === 1 && now - prev.lastFailAt >= 2 * 60 * 1000) ||
    (prev.fails === 2 && now - prev.lastFailAt >= 5 * 60 * 1000) ||
    (prev.fails >= 3 && now - prev.lastFailAt >= 15 * 60 * 1000)
  if (!backoffOk) return

  const fails = prev.fails + 1
  const next: { fails: number; lastFailAt: number; circuitOpenUntil?: number } = {
    fails,
    lastFailAt: now,
  }
  if (fails >= CIRCUIT_FAIL_THRESHOLD) {
    next.circuitOpenUntil = now + CIRCUIT_OPEN_MS
    next.fails = 0
  }
  failureState.set(key, next)
}

function recordSuccess(shopId: string | undefined, apiName: string): void {
  failureState.delete(failureKey(shopId, apiName))
}

export interface XhsAuditedRequestResult<T> {
  ok: boolean
  data: T | null
  auditStatus: SyncRequestStatus
  errorMessage: string | null
  skippedRemote: boolean
}

export async function runXhsRequestWithAuditAndThrottle<T>(params: {
  shopId?: string
  shopName?: string
  apiName: string
  method: string
  urlKey: string
  requestHash: string
  trigger?: SyncRequestTrigger
  pageNo?: number
  cooldownOverrideMs?: number
  cooldownScopeKey?: string
  execute: () => Promise<{
    ok: boolean
    data: T | null
    httpStatus?: number
    itemCount?: number
    errorMessage?: string | null
  }>
}): Promise<XhsAuditedRequestResult<T>> {
  const startedAt = new Date().toISOString()
  const trigger = params.trigger ?? 'unknown'
  const gate = await checkXhsRequestAllowedWithJsonlCooldown({
    shopId: params.shopId,
    apiName: params.apiName,
    requestHash: params.requestHash,
    trigger,
    cooldownOverrideMs: params.cooldownOverrideMs,
    cooldownScopeKey: params.cooldownScopeKey,
  })

  if (!gate.allowed) {
    await appendSyncRequestAudit({
      shopId: params.shopId,
      shopName: params.shopName,
      source: 'xhs',
      apiName: params.apiName,
      method: params.method,
      urlKey: params.urlKey,
      requestHash: params.requestHash,
      cooldownScopeKey: params.cooldownScopeKey,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      status: gate.status,
      pageNo: params.pageNo,
      errorMessage: gate.reason,
      trigger,
    })
    return {
      ok: false,
      data: null,
      auditStatus: gate.status,
      errorMessage: gate.reason ?? '请求被跳过',
      skippedRemote: true,
    }
  }

  const t0 = Date.now()
  try {
    const result = await params.execute()
    const finishedAt = new Date().toISOString()
    const status: SyncRequestStatus = result.ok ? 'success' : 'failed'
    if (result.ok) {
      recordSuccess(params.shopId, params.apiName)
      lastRequestAt.set(
        auditKey(params.shopId, params.apiName, params.requestHash, params.cooldownScopeKey),
        Date.now(),
      )
    } else {
      recordFailure(params.shopId, params.apiName)
    }
    await appendSyncRequestAudit({
      shopId: params.shopId,
      shopName: params.shopName,
      source: 'xhs',
      apiName: params.apiName,
      method: params.method,
      urlKey: params.urlKey,
      requestHash: params.requestHash,
      cooldownScopeKey: params.cooldownScopeKey,
      startedAt,
      finishedAt,
      durationMs: Date.now() - t0,
      status,
      httpStatus: result.httpStatus,
      itemCount: result.itemCount,
      pageNo: params.pageNo,
      errorMessage: result.errorMessage ?? undefined,
      trigger,
    })
    return {
      ok: result.ok,
      data: result.data,
      auditStatus: status,
      errorMessage: result.errorMessage ?? null,
      skippedRemote: false,
    }
  } catch (err) {
    recordFailure(params.shopId, params.apiName)
    const message = err instanceof Error ? err.message : String(err)
    await appendSyncRequestAudit({
      shopId: params.shopId,
      shopName: params.shopName,
      source: 'xhs',
      apiName: params.apiName,
      method: params.method,
      urlKey: params.urlKey,
      requestHash: params.requestHash,
      cooldownScopeKey: params.cooldownScopeKey,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      status: 'failed',
      pageNo: params.pageNo,
      errorMessage: message,
      trigger,
    })
    return { ok: false, data: null, auditStatus: 'failed', errorMessage: message, skippedRemote: false }
  }
}

export async function buildSyncRiskStatus(): Promise<SyncRiskStatus> {
  const since = Date.now() - 24 * 60 * 60 * 1000
  let jsonlReadWarning: string | undefined
  let jsonlItems: SyncRequestAuditItem[] = []
  try {
    jsonlItems = await loadRecentAuditItemsFromJsonl(since)
  } catch (err) {
    jsonlReadWarning = `读取 JSONL 审计日志失败：${err instanceof Error ? err.message : String(err)}`
    logWarn('接口审计', jsonlReadWarning)
  }

  const bufferItems = recentAuditBuffer.filter((i) => Date.parse(i.startedAt) >= since)
  const items = mergeAuditItems(jsonlItems, bufferItems)

  let requestCount24h = 0
  let throttledCount24h = 0
  let failedCount24h = 0
  let circuitOpenCount24h = 0
  const highRiskApis = new Set<string>()

  for (const i of items) {
    if (i.status === 'success' || i.status === 'failed') requestCount24h += 1
    if (i.status === 'throttled') throttledCount24h += 1
    if (i.status === 'failed') failedCount24h += 1
    if (i.status === 'circuit_open') circuitOpenCount24h += 1
    if (i.trigger === 'page_open') highRiskApis.add(i.apiName)
  }

  let directRequestFindings: SyncRiskStatus['directRequestFindings'] = []
  try {
    const { scanDirectXhsRequestFindings } = await import('./xhs-sync-frequency-scan.util')
    directRequestFindings = scanDirectXhsRequestFindings()
    for (const f of directRequestFindings) {
      if (f.risk === 'high') highRiskApis.add(`${f.file}:${f.line}`)
    }
  } catch (err) {
    jsonlReadWarning =
      (jsonlReadWarning ? `${jsonlReadWarning}; ` : '') +
      `扫描直连请求失败：${err instanceof Error ? err.message : String(err)}`
  }

  const highCount = directRequestFindings.filter((f) => f.risk === 'high').length
  let status: SyncRiskStatus['status'] = 'pass'
  if (jsonlReadWarning) status = 'warning'
  if (failedCount24h >= 20 || circuitOpenCount24h > 0 || highCount > 0) status = 'danger'
  else if (requestCount24h >= 500 || throttledCount24h >= 50) status = 'warning'

  return {
    status,
    requestCount24h,
    throttledCount24h,
    failedCount24h,
    circuitOpenCount24h,
    highRiskApis: [...highRiskApis],
    directRequestFindings,
    jsonlReadWarning,
    note: jsonlReadWarning
      ? `最近 24 小时统计来自 JSONL+内存合并，但存在读取/扫描告警：${jsonlReadWarning}`
      : status === 'pass'
        ? '最近 24 小时接口请求在可控范围内（JSONL+内存合并）'
        : status === 'warning'
          ? '请求频率偏高或日志读取有告警，请关注冷却与分页策略'
          : '存在熔断或高风险直连请求，请优先处理',
  }
}

/** 测试/验收用：重置内存状态 */
export function resetSyncRequestAuditStateForTests(): void {
  lastRequestAt.clear()
  failureState.clear()
  recentAuditBuffer.length = 0
  jsonlCooldownCache = null
}

export function forceCircuitOpenForTests(shopId: string | undefined, apiName: string): void {
  failureState.set(failureKey(shopId, apiName), {
    fails: 0,
    lastFailAt: Date.now(),
    circuitOpenUntil: Date.now() + CIRCUIT_OPEN_MS,
  })
}
