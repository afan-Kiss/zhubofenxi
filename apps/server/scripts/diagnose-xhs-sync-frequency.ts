#!/usr/bin/env tsx
import { scanXhsSyncFrequencyReport } from '../src/services/xhs-sync-frequency-scan.util'

function main() {
  const findings = scanXhsSyncFrequencyReport()
  console.log('[diagnose:xhs-sync-frequency] findings:', findings.length)
  for (const f of findings.slice(0, 30)) {
    console.log(
      `- [${f.risk}] ${f.apiName} ${f.file}:${f.line} trigger=${f.trigger} audit=${f.hasAudit} cooldown=${f.hasCooldown}`,
    )
  }
  const high = findings.filter((f) => f.risk === 'high')
  if (high.length > 0) {
    console.warn(`[diagnose:xhs-sync-frequency] WARN high risk: ${high.length}`)
  } else {
    console.log('[diagnose:xhs-sync-frequency] PASS (no high risk in scan sample)')
  }
}

main()
