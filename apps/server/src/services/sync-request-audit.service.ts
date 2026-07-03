import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDataDir } from '../config/env'
import { formatDateKeyShanghai } from '../utils/business-timezone'

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
    note: string
  }>
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
}

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000
const CIRCUIT_FAIL_THRESHOLD = 5
const CIRCUIT_OPEN_MS = 60 * 60 * 1000

const lastRequestAt = new Map<string, number>()
const failureState = new Map<string, { fails: number; lastFailAt: number; circuitOpenUntil?: number }>()
const recentAuditBuffer: SyncRequestAuditItem[] = []

function auditKey(shopId: string | undefined, apiName: string, requestHash: string): string {
  return `${shopId ?? 'default'}::${apiName}::${requestHash}`
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

export function resolveApiCooldownMs(apiName: string): number {
  return COOLDOWN_MS_BY_API[apiName] ?? DEFAULT_COOLDOWN_MS
}

export function checkXhsRequestAllowed(params: {
  shopId?: string
  apiName: string
  requestHash: string
  trigger?: SyncRequestTrigger
}): { allowed: boolean; status: SyncRequestStatus; reason?: string } {
  if (params.trigger === 'page_open') {
    return {
      allowed: false,
      status: 'throttled',
      reason: '页面接口禁止直接请求小红书，请使用本地缓存或受控同步任务',
    }
  }

  const fKey = failureKey(params.shopId, params.apiName)
  const fState = failureState.get(fKey)
  const now = Date.now()
  if (fState?.circuitOpenUntil && fState.circuitOpenUntil > now) {
    return { allowed: false, status: 'circuit_open', reason: '接口熔断中，请稍后再试' }
  }

  const key = auditKey(params.shopId, params.apiName, params.requestHash)
  const last = lastRequestAt.get(key)
  const cooldown = resolveApiCooldownMs(params.apiName)
  if (last != null && now - last < cooldown) {
    return { allowed: false, status: 'throttled', reason: `冷却中（${Math.ceil((cooldown - (now - last)) / 1000)}s）` }
  }

  return { allowed: true, status: 'skipped' }
}

export async function appendSyncRequestAudit(item: SyncRequestAuditItem): Promise<void> {
  recentAuditBuffer.push(item)
  if (recentAuditBuffer.length > 5000) recentAuditBuffer.splice(0, recentAuditBuffer.length - 5000)

  const day = formatDateKeyShanghai(new Date(item.startedAt))
  const dir = path.join(getDataDir(), 'sync-request-audit')
  await fs.mkdir(dir, { recursive: true })
  await fs.appendFile(path.join(dir, `${day}.jsonl`), `${JSON.stringify(item)}\n`, 'utf8')
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
  const gate = checkXhsRequestAllowed({
    shopId: params.shopId,
    apiName: params.apiName,
    requestHash: params.requestHash,
    trigger,
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
      lastRequestAt.set(auditKey(params.shopId, params.apiName, params.requestHash), Date.now())
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
  const items = recentAuditBuffer.filter((i) => Date.parse(i.startedAt) >= since)
  let requestCount24h = 0
  let throttledCount24h = 0
  let failedCount24h = 0
  let circuitOpenCount24h = 0
  const highRiskApis = new Set<string>()

  for (const i of items) {
    if (i.status === 'success' || i.status === 'failed') requestCount24h += 1
    if (i.status === 'throttled' || i.status === 'skipped') throttledCount24h += 1
    if (i.status === 'failed') failedCount24h += 1
    if (i.status === 'circuit_open') circuitOpenCount24h += 1
    if (i.trigger === 'page_open') highRiskApis.add(i.apiName)
  }

  let directRequestFindings: SyncRiskStatus['directRequestFindings'] = []
  try {
    const { scanDirectXhsRequestFindings } = await import('./xhs-sync-frequency-scan.util')
    directRequestFindings = scanDirectXhsRequestFindings()
    for (const f of directRequestFindings) {
      if (f.risk === 'high') highRiskApis.add(f.file)
    }
  } catch {
    directRequestFindings = []
  }

  const highCount = highRiskApis.size + directRequestFindings.filter((f) => f.risk === 'high').length
  let status: SyncRiskStatus['status'] = 'pass'
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
    note:
      status === 'pass'
        ? '最近 24 小时接口请求在可控范围内'
        : status === 'warning'
          ? '请求频率偏高，请关注冷却与分页策略'
          : '存在熔断或高风险直连请求，请优先处理',
  }
}

/** 测试/验收用：重置内存状态 */
export function resetSyncRequestAuditStateForTests(): void {
  lastRequestAt.clear()
  failureState.clear()
  recentAuditBuffer.length = 0
}

export function forceCircuitOpenForTests(shopId: string | undefined, apiName: string): void {
  failureState.set(failureKey(shopId, apiName), {
    fails: 0,
    lastFailAt: Date.now(),
    circuitOpenUntil: Date.now() + CIRCUIT_OPEN_MS,
  })
}
