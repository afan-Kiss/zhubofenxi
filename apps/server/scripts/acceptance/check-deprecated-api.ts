/**
 * 旧接口必须已删除或返回 410/404（静态检查 route 源码 + 可选 HTTP 探测）
 */
import fs from 'node:fs'
import { repoPath, pass, fail, readText } from './_shared'

const ROUTE_CHECKS: Array<{ file: string; patterns: RegExp[]; optional?: boolean }> = [
  {
    file: 'apps/server/src/routes/board.routes.ts',
    patterns: [
      /boardRouter\.get\('\/overview'/,
      /boardRouter\.get\('\/anchors\/performance'/,
      /boardRouter\.get\('\/orders'/,
      /boardRouter\.get\('\/buyer-ranking'/,
      /boardRouter\.post\('\/live-query'/,
    ],
  },
  {
    file: 'apps/server/src/routes/dashboard.routes.ts',
    patterns: [/dashboardRouter/],
    optional: true,
  },
  {
    file: 'apps/server/src/routes/bi.routes.ts',
    patterns: [/biRouter/],
    optional: true,
  },
]

const errors: string[] = []

function recordError(msg: string): void {
  errors.push(msg)
  console.error(`[acceptance] FAIL: ${msg}`)
}

function assertRouteRemoved(source: string, pattern: RegExp, label: string): void {
  if (!pattern.test(source)) {
    pass(`${label} 路由已删除`)
    return
  }
  recordError(`${label} 仍存在，应删除或返回 410`)
}

async function probeHttp(baseUrl: string): Promise<void> {
  const paths = [
    '/api/board/overview',
    '/api/board/anchors/performance',
    '/api/dashboard/snapshot/latest',
    '/api/bi/summary',
  ]
  for (const p of paths) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}${p}`)
      if (res.status === 410 || res.status === 404) {
        pass(`HTTP ${p} → ${res.status}`)
      } else {
        recordError(`HTTP ${p} 应返回 410/404，实际 ${res.status}`)
      }
    } catch (err) {
      recordError(`HTTP ${p} 探测失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function main(): Promise<void> {
  console.log('[check-deprecated-api] 检查旧接口…\n')

  for (const { file, patterns, optional } of ROUTE_CHECKS) {
    const full = repoPath(file)
    if (!fs.existsSync(full)) {
      if (optional) {
        pass(`${file} 已移除`)
      } else {
        recordError(`缺少路由文件 ${file}`)
      }
      continue
    }
    const source = readText(full)
    for (const p of patterns) {
      assertRouteRemoved(source, p, `${file} ${p}`)
    }
  }

  const baseUrl = process.env.ACCEPTANCE_BASE_URL
  if (baseUrl) {
    await probeHttp(baseUrl)
  } else {
    pass('跳过 HTTP 探测（未设置 ACCEPTANCE_BASE_URL）')
  }

  console.log('')
  if (errors.length > 0) {
    fail(`旧接口检查失败（${errors.length} 项）`, errors)
  }
  console.log('[check-deprecated-api] PASS')
}

void main()
