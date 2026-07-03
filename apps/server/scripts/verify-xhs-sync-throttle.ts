#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanDirectXhsRequestFindings } from '../src/services/xhs-sync-frequency-scan.util'

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
  const highInRoutes = findings.filter((f) => f.risk === 'high' && f.file.includes('routes/'))
  assert(highInRoutes.length === 0, `页面路由不应 high 风险直连小红书（${highInRoutes.length} 处）`, issues)

  if (issues.length > 0) {
    console.error('[verify:xhs-sync-throttle] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:xhs-sync-throttle] PASS')
}

main()
