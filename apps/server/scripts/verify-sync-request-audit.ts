#!/usr/bin/env tsx
import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataDir } from '../src/config/env'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import {
  appendSyncRequestAudit,
  buildSyncRiskStatus,
  buildXhsRequestHash,
  checkXhsRequestAllowed,
  forceCircuitOpenForTests,
  resetSyncRequestAuditStateForTests,
  runXhsRequestWithAuditAndThrottle,
} from '../src/services/sync-request-audit.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function main() {
  const issues: string[] = []
  resetSyncRequestAuditStateForTests()

  const hash = buildXhsRequestHash({ apiName: 'order_list', query: { page: '1' } })
  assert(hash.length === 16, 'requestHash 应为 16 位', issues)

  const pageBlock = checkXhsRequestAllowed({
    apiName: 'order_list',
    requestHash: hash,
    trigger: 'page_open',
  })
  assert(!pageBlock.allowed && pageBlock.status === 'throttled', 'page_open 应被阻止', issues)

  let executed = 0
  await runXhsRequestWithAuditAndThrottle({
    apiName: 'order_list',
    method: 'POST',
    urlKey: '/test',
    requestHash: hash,
    trigger: 'scheduled',
    execute: async () => {
      executed += 1
      return { ok: true, data: { ok: true }, itemCount: 1, errorMessage: null }
    },
  })
  assert(executed === 1, '首次请求应执行', issues)

  const second = await runXhsRequestWithAuditAndThrottle({
    apiName: 'order_list',
    method: 'POST',
    urlKey: '/test',
    requestHash: hash,
    trigger: 'scheduled',
    execute: async () => {
      executed += 1
      return { ok: true, data: {}, errorMessage: null }
    },
  })
  assert(second.skippedRemote && second.auditStatus === 'throttled', '5 分钟内重复应 throttled', issues)
  assert(executed === 1, '冷却命中时不应真的请求小红书', issues)

  resetSyncRequestAuditStateForTests()
  const failHash = buildXhsRequestHash({ apiName: 'order_detail', query: { id: '1' } })
  forceCircuitOpenForTests(undefined, 'order_detail')
  const circuit = checkXhsRequestAllowed({
    apiName: 'order_detail',
    requestHash: failHash,
    trigger: 'retry',
  })
  assert(circuit.status === 'circuit_open', '连续失败 >=5 应熔断', issues)

  resetSyncRequestAuditStateForTests()
  const startedAt = new Date().toISOString()
  await appendSyncRequestAudit({
    source: 'xhs',
    apiName: 'order_list',
    method: 'POST',
    urlKey: '/verify',
    requestHash: 'verify-jsonl-001',
    startedAt,
    finishedAt: startedAt,
    durationMs: 12,
    status: 'success',
    trigger: 'scheduled',
  })

  const day = formatDateKeyShanghai(new Date(startedAt))
  const jsonlPath = path.join(getDataDir(), 'sync-request-audit', `${day}.jsonl`)
  const jsonlRaw = await fs.readFile(jsonlPath, 'utf8')
  assert(jsonlRaw.includes('verify-jsonl-001'), 'JSONL 应写入审计记录', issues)

  resetSyncRequestAuditStateForTests()
  const riskAfterRestart = await buildSyncRiskStatus()
  assert(
    riskAfterRestart.requestCount24h >= 1,
    '重置内存 buffer 后 buildSyncRiskStatus 仍应读到 JSONL 最近24小时数据',
    issues,
  )

  if (issues.length > 0) {
    console.error('[verify:sync-request-audit] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:sync-request-audit] PASS')
}

void main()
