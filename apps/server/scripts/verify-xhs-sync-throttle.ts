#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanDirectXhsRequestFindings } from '../src/services/xhs-sync-frequency-scan.util'

const ALLOWED_REQUEST_XHS_JSON = new Set([
  'apps/server/src/services/xhs-api-sync/xhs-api-client.service.ts',
  'apps/server/src/services/xhs-http.service.ts',
  'apps/server/src/services/sync-request-audit.service.ts',
])

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function main() {
  const issues: string[] = []
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const client = fs.readFileSync(
    path.join(root, 'apps/server/src/services/xhs-api-sync/xhs-api-client.service.ts'),
    'utf8',
  )
  assert(
    client.includes('runXhsRequestWithAuditAndThrottle'),
    'requestXhsApi 应接入 runXhsRequestWithAuditAndThrottle',
    issues,
  )
  assert(client.includes('buildXhsRequestHash'), 'requestXhsApi 应使用 requestHash', issues)

  const findings = scanDirectXhsRequestFindings(root)
  const highDirectJson = findings.filter(
    (f) => f.risk === 'high' && f.reason.includes('requestXhsJson'),
  )
  const illegalJson = highDirectJson.filter((f) => !ALLOWED_REQUEST_XHS_JSON.has(f.file))
  if (illegalJson.length > 0) {
    for (const f of illegalJson.slice(0, 10)) {
      issues.push(
        `绕过统一包装: ${f.file}:${f.line} [${f.risk}] ${f.reason} → ${f.suggestion}`,
      )
    }
    if (illegalJson.length > 10) {
      issues.push(`…另有 ${illegalJson.length - 10} 处 requestXhsJson 高风险点`)
    }
  }

  const highInRoutes = findings.filter(
    (f) =>
      f.risk === 'high' &&
      f.file.includes('routes/') &&
      !f.reason.includes('requestXhsJsonWithSyncAudit'),
  )
  assert(highInRoutes.length === 0, `routes 里直接触发小红书请求（${highInRoutes.length} 处）`, issues)

  if (issues.length > 0) {
    console.error('[verify:xhs-sync-throttle] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:xhs-sync-throttle] PASS')
}

main()
