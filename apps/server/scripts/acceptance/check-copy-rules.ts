/**
 * 扫描源码禁用词；docs 目录豁免。
 * 已知遗留命中见 copy-rules-baseline.json，新增命中将失败。
 */
import {
  fail,
  loadJson,
  pass,
  readText,
  repoPath,
  toRepoRelative,
  walkFiles,
} from './_shared'

const FORBIDDEN_TERMS = [
  'TOP',
  '贡献',
  '黑名单',
  '提成',
  '工资',
  '扣款',
  '责任',
  '毛利润',
  '平台结算',
  '账单对账',
  '财务中心',
] as const

const SCAN_ROOTS = [
  repoPath('apps/web/src'),
  repoPath('apps/server/src'),
]

interface BaselineFile {
  entries: string[]
}

function loadBaseline(): Set<string> {
  const file = repoPath('apps/server/scripts/acceptance/copy-rules-baseline.json')
  const data = loadJson<BaselineFile>(file)
  return new Set(data.entries)
}

function scan(): Map<string, Set<string>> {
  const hits = new Map<string, Set<string>>()

  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const rel = toRepoRelative(file)
      if (rel.startsWith('docs/')) continue

      const text = readText(file)
      for (const term of FORBIDDEN_TERMS) {
        if (!text.includes(term)) continue
        const key = `${rel}:${term}`
        if (!hits.has(key)) hits.set(key, new Set())
        hits.get(key)!.add(term)
      }
    }
  }
  return hits
}

function main(): void {
  const baseline = loadBaseline()
  const hits = scan()
  const newViolations: string[] = []

  for (const key of hits.keys()) {
    if (!baseline.has(key)) {
      const term = key.split(':').pop() ?? key
      newViolations.push(`${key}（禁用词：${term}）`)
    }
  }

  if (newViolations.length > 0) {
    fail(
      `发现 ${newViolations.length} 处新增禁用词命中（相对 baseline）。请改用 docs/UI_COPY_RULES.md 推荐表达，或确认非用户可见文案后更新 baseline。`,
      newViolations.sort(),
    )
  }

  pass(
    `禁用词检查通过（扫描 apps/web/src、apps/server/src；baseline ${baseline.size} 条遗留豁免）`,
  )
}

main()
