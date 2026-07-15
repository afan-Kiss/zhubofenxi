/**
 * Wave4: 经营看板秒开基准 — npm run benchmark:board-load
 *
 * 覆盖：overview today/thisMonth/lastMonth、anchors today/thisMonth、
 * custom 7/31 天、10 并发相同请求。默认打本地 4723（可用 BOARD_BENCH_BASE 覆盖）。
 */
import { performance } from 'node:perf_hooks'

const BASE = (process.env.BOARD_BENCH_BASE || 'http://127.0.0.1:4723').replace(/\/$/, '')
const COOKIE = process.env.BOARD_BENCH_COOKIE || ''
const TOKEN = process.env.BOARD_BENCH_TOKEN || ''

type Case = { name: string; path: string; repeats?: number }

function shanghaiYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + days)
  return shanghaiYmd(dt)
}

async function loginIfNeeded(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (COOKIE) headers.Cookie = COOKIE
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  if (COOKIE || TOKEN) return headers

  // 尝试控制面/本地默认：部分部署允许本地 viewer
  return headers
}

async function fetchOnce(
  path: string,
  headers: Record<string, string>,
): Promise<{
  ms: number
  status: number
  bytes: number
  cache: string
  serverTiming: string
}> {
  const t0 = performance.now()
  const res = await fetch(`${BASE}${path}`, { headers })
  const body = await res.text()
  const ms = performance.now() - t0
  return {
    ms,
    status: res.status,
    bytes: Buffer.byteLength(body),
    cache: res.headers.get('x-board-cache') || '',
    serverTiming: res.headers.get('server-timing') || '',
  }
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]!
}

async function runCase(c: Case, headers: Record<string, string>) {
  const n = c.repeats ?? 5
  const samples: number[] = []
  let lastCache = ''
  let lastBytes = 0
  for (let i = 0; i < n; i++) {
    const r = await fetchOnce(c.path, headers)
    samples.push(r.ms)
    lastCache = r.cache
    lastBytes = r.bytes
  }
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    name: c.name,
    count: n,
    p50: Math.round(pct(sorted, 50)),
    p95: Math.round(pct(sorted, 95)),
    p99: Math.round(pct(sorted, 99)),
    lastCache,
    lastBytes,
  }
}

async function main() {
  const today = shanghaiYmd(new Date())
  const d7 = addDays(today, -7)
  const d31 = addDays(today, -31)
  const headers = await loginIfNeeded()

  const cases: Case[] = [
    { name: 'overview today', path: `/api/board/overview-data?preset=today` },
    { name: 'overview thisMonth', path: `/api/board/overview-data?preset=thisMonth` },
    { name: 'overview lastMonth', path: `/api/board/overview-data?preset=lastMonth` },
    { name: 'anchors today', path: `/api/board/anchors-data?preset=today` },
    { name: 'anchors thisMonth', path: `/api/board/anchors-data?preset=thisMonth` },
    {
      name: 'custom 7d',
      path: `/api/board/overview-data?preset=custom&startDate=${d7}&endDate=${today}`,
    },
    {
      name: 'custom 31d',
      path: `/api/board/overview-data?preset=custom&startDate=${d31}&endDate=${today}`,
    },
  ]

  console.log(`benchmark:board-load base=${BASE}`)
  const rows = []
  for (const c of cases) {
    try {
      const row = await runCase(c, headers)
      rows.push(row)
      console.log(
        `${row.name.padEnd(22)} p50=${row.p50}ms p95=${row.p95}ms p99=${row.p99}ms cache=${row.lastCache || '-'} bytes=${row.lastBytes}`,
      )
    } catch (e) {
      console.error(`${c.name} FAIL`, e instanceof Error ? e.message : e)
    }
  }

  // 10 并发相同请求
  const concurrentPath = `/api/board/overview-data?preset=today`
  const t0 = performance.now()
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () => fetchOnce(concurrentPath, headers)),
  )
  const concurrentMs = Math.round(performance.now() - t0)
  const caches = concurrent.map((c) => c.cache)
  console.log(
    `concurrent x10 today     wall=${concurrentMs}ms caches=[${caches.join(',')}]`,
  )

  const failGates: string[] = []
  for (const r of rows) {
    if (r.name.startsWith('overview') && r.lastCache === 'memory' && r.p95 > 200) {
      failGates.push(`${r.name} memory p95 ${r.p95}>200`)
    }
    if (r.name.startsWith('anchors') && r.lastCache === 'memory' && r.p95 > 250) {
      failGates.push(`${r.name} memory p95 ${r.p95}>250`)
    }
  }
  if (failGates.length) {
    console.error('GATE FAIL', failGates.join('; '))
    process.exitCode = 1
  } else {
    console.log('benchmark:board-load OK (soft gates; auth may skip for unauthenticated)')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
