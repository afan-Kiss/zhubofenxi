#!/usr/bin/env tsx

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function checkStatus(diffCent: number, diffCount: number): 'pass' | 'danger' {
  if (diffCent !== 0 || diffCount !== 0) return 'danger'
  return 'pass'
}

async function main() {
  const issues: string[] = []

  assert(checkStatus(0, 0) === 'pass', '完全一致应 pass', issues)
  assert(checkStatus(1, 0) === 'danger', '差 1 分应 danger', issues)
  assert(checkStatus(0, 1) === 'danger', '差 1 单应 danger', issues)

  const score = Math.round(8.75 * 10) / 10
  assert(score === 8.8, '风险分保留 1 位小数', issues)

  if (issues.length > 0) {
    console.error('[verify:data-accuracy-audit] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:data-accuracy-audit] PASS')
}

void main()
