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
  reason: string
  suggestion: string
}

const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..')

const ALLOWED_REQUEST_XHS_JSON = new Set([
  'apps/server/src/services/xhs-api-sync/xhs-api-client.service.ts',
  'apps/server/src/services/xhs-http.service.ts',
  'apps/server/src/services/sync-request-audit.service.ts',
])

const SKIP_PATH_PARTS = [
  '/node_modules/',
  '/dist/',
  'verify-xhs-sync-throttle',
  'diagnose-xhs-sync-frequency',
  'xhs-sync-frequency-scan.util',
  'apps/server/scripts/',
]

const SCAN_PATTERNS: Array<{
  re: RegExp
  reason: string
  suggestion: string
  defaultRisk: 'low' | 'medium' | 'high'
}> = [
  {
    re: /requestXhsJson\s*\(/,
    reason: '直接调用 requestXhsJson，可能绕过统一审计与冷却',
    suggestion: '改为 requestXhsApi / runXhsRequestWithAuditAndThrottle / requestXhsJsonWithSyncAudit',
    defaultRisk: 'high',
  },
  {
    re: /requestXhsJsonWithSyncAudit\s*\(/,
    reason: '经 requestXhsJsonWithSyncAudit 包装',
    suggestion: '确认 trigger 与 apiName 正确',
    defaultRisk: 'low',
  },
  {
    re: /fetch\s*\(\s*['"`]https?:\/\/[^'"`]*xiaohongshu/i,
    reason: '直接 fetch 小红书域名',
    suggestion: '改为 requestXhsApi / requestXhsJsonWithSyncAudit',
    defaultRisk: 'high',
  },
  {
    re: /axios\.(?:get|post|request)\s*\(\s*['"`]https?:\/\/[^'"`]*xiaohongshu/i,
    reason: 'axios 直连小红书域名',
    suggestion: '改为 requestXhsApi / requestXhsJsonWithSyncAudit',
    defaultRisk: 'high',
  },
  {
    re: /setInterval\s*\(/,
    reason: '存在 setInterval 定时逻辑',
    suggestion: '确认频率与冷却，避免页面打开触发',
    defaultRisk: 'medium',
  },
  {
    re: /while\s*\(\s*true\s*\)/,
    reason: '存在 while(true) 循环',
    suggestion: '确认有 backoff 且不会高频请求小红书',
    defaultRisk: 'high',
  },
]

function shouldSkipFile(rel: string): boolean {
  return SKIP_PATH_PARTS.some((p) => rel.includes(p))
}

function resolveRisk(
  rel: string,
  line: string,
  pattern: (typeof SCAN_PATTERNS)[number],
): 'low' | 'medium' | 'high' {
  if (pattern.re.source.includes('requestXhsJsonWithSyncAudit')) return 'low'
  if (pattern.re.source.includes('requestXhsJson')) {
    if (ALLOWED_REQUEST_XHS_JSON.has(rel)) return 'low'
    return 'high'
  }
  if (pattern.re.source.includes('setInterval')) {
    if (rel.includes('scheduler.service') || rel.includes('-scheduler.service')) return 'low'
    if (rel.includes('cleanup') || rel.includes('CacheCleanup')) return 'low'
    return pattern.defaultRisk
  }
  if (rel.includes('routes/') && !line.includes('cache') && !line.includes('local')) {
    if (
      pattern.re.source.includes('fetch') ||
      pattern.re.source.includes('requestXhsJson') ||
      pattern.re.source.includes('axios')
    ) {
      return 'high'
    }
  }
  return pattern.defaultRisk
}

export function scanDirectXhsRequestFindings(root = REPO_ROOT): XhsSyncFrequencyFinding[] {
  const findings: XhsSyncFrequencyFinding[] = []
  const scanDirs = [path.join(root, 'apps/server/src'), path.join(root, 'apps/web/src')]

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
      if (shouldSkipFile(rel)) continue
      const content = fs.readFileSync(full, 'utf8')
      const lines = content.split('\n')
      const hasAuditedWrapper =
        /runXhsRequestWithAuditAndThrottle|requestXhsApi\s*\(|requestXhsJsonWithSyncAudit\s*\(/.test(
          content,
        )

      lines.forEach((line, idx) => {
        for (const p of SCAN_PATTERNS) {
          if (!p.re.test(line)) continue
          const risk = resolveRisk(rel, line, p)
          findings.push({
            apiName: 'unknown',
            file: rel,
            line: idx + 1,
            trigger: rel.includes('routes/') ? 'http_route' : 'service',
            hasAudit: hasAuditedWrapper,
            hasCooldown: rel.includes('sync-request-audit'),
            risk,
            reason: p.reason,
            suggestion: p.suggestion,
          })
        }
      })
    }
  }

  for (const d of scanDirs) walk(d)
  return findings
}

export function scanXhsSyncFrequencyReport(root = REPO_ROOT): XhsSyncFrequencyFinding[] {
  const apiHits = [
    { key: 'order_list', re: /order_list|syncOrderList|订单列表/ },
    { key: 'after_sales', re: /afterSales|after-sales|售后/ },
    { key: 'settlement', re: /settlement|结算/ },
    { key: 'live_session', re: /liveSession|live_session|直播场次/ },
    { key: 'good_review', re: /goodReview|good-review|好评/ },
  ]

  return scanDirectXhsRequestFindings(root).map((f) => ({
    ...f,
    apiName: apiHits.find((h) => h.re.test(f.file))?.key ?? 'unknown',
  }))
}
