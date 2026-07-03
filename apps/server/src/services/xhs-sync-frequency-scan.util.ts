import fs from 'node:fs'
import path from 'node:path'
import { SERVER_ROOT } from '../config/env'

export interface XhsSyncFrequencyFinding {
  apiName: string
  file: string
  line: number
  trigger: string
  hasAudit: boolean
  hasCooldown: boolean
  risk: 'low' | 'medium' | 'high'
  suggestion: string
}

const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..')

const HIGH_PATTERNS: Array<{ re: RegExp; note: string }> = [
  { re: /requestXhsJson\s*\(/, note: '直接调用 requestXhsJson，可能绕过统一审计' },
  { re: /fetch\s*\(\s*['"`]https?:\/\/[^'"`]*xiaohongshu/, note: '直接 fetch 小红书域名' },
  { re: /fetch\s*\(\s*['"`]https?:\/\/[^'"`]*xhs/i, note: '直接 fetch xhs 域名' },
  { re: /setInterval\s*\(/, note: '存在 setInterval 定时逻辑' },
  { re: /while\s*\(\s*true\s*\)/, note: '存在 while(true) 循环' },
]

const AUDITED_OK = /runXhsRequestWithAuditAndThrottle|requestXhsApi\s*\(/

export function scanDirectXhsRequestFindings(root = REPO_ROOT): Array<{
  file: string
  line: number
  risk: 'low' | 'medium' | 'high'
  note: string
}> {
  const findings: Array<{ file: string; line: number; risk: 'low' | 'medium' | 'high'; note: string }> = []
  const scanDirs = [
    path.join(root, 'apps/server/src'),
    path.join(root, 'apps/web/src'),
  ]

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue
        walk(full)
        continue
      }
      if (!/\.(ts|tsx|js)$/.test(name)) continue
      const rel = path.relative(root, full).replace(/\\/g, '/')
      if (rel.includes('verify-xhs-sync-throttle') || rel.includes('diagnose-xhs-sync-frequency')) continue
      const content = fs.readFileSync(full, 'utf8')
      const lines = content.split('\n')
      lines.forEach((line, idx) => {
        for (const p of HIGH_PATTERNS) {
          if (!p.re.test(line)) continue
          const hasAudit = AUDITED_OK.test(content)
          let risk: 'low' | 'medium' | 'high' = hasAudit ? 'medium' : 'high'
          if (p.re.source.includes('setInterval') && rel.includes('scheduler.service')) risk = 'low'
          if (p.re.source.includes('requestXhsJson') && rel.includes('xhs-api-client.service')) risk = 'low'
          findings.push({
            file: rel,
            line: idx + 1,
            risk,
            note: p.note,
          })
        }
      })
    }
  }

  for (const d of scanDirs) walk(d)
  return findings
}

export function scanXhsSyncFrequencyReport(root = REPO_ROOT): XhsSyncFrequencyFinding[] {
  const findings: XhsSyncFrequencyFinding[] = []
  const apiHits = [
    { key: 'order_list', re: /order_list|syncOrderList|订单列表/ },
    { key: 'after_sales', re: /afterSales|after-sales|售后/ },
    { key: 'settlement', re: /settlement|结算/ },
    { key: 'live_session', re: /liveSession|live_session|直播场次/ },
    { key: 'good_review', re: /goodReview|good-review|好评/ },
  ]

  for (const f of scanDirectXhsRequestFindings(root)) {
    const apiName = apiHits.find((h) => h.re.test(f.file))?.key ?? 'unknown'
    findings.push({
      apiName,
      file: f.file,
      line: f.line,
      trigger: f.file.includes('routes/') ? 'http_route' : 'service',
      hasAudit: f.note.includes('requestXhsJson') ? false : AUDITED_OK.test(fs.readFileSync(path.join(root, f.file), 'utf8')),
      hasCooldown: f.file.includes('sync-request-audit'),
      risk: f.risk,
      suggestion: f.risk === 'high' ? '改为 runXhsRequestWithAuditAndThrottle / requestXhsApi' : '确认触发频率与冷却',
    })
  }
  return findings
}
