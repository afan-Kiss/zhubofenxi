#!/usr/bin/env tsx
import {
  buildXhsRequestHash,
  checkXhsRequestAllowed,
  resetSyncRequestAuditStateForTests,
  runXhsRequestWithAuditAndThrottle,
  forceCircuitOpenForTests,
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

  if (issues.length > 0) {
    console.error('[verify:sync-request-audit] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:sync-request-audit] PASS')
}

void main()
