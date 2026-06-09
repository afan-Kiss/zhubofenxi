/**
 * 检查金额格式化函数是否使用「万」缩写或 /10000 换算展示。
 */
import {
  fail,
  pass,
  readText,
  repoPath,
  toRepoRelative,
  walkFiles,
} from './_shared'

const MONEY_FILE_HINTS = [
  'format-money',
  'formatMoney',
  'AmountDisplay',
  'money.ts',
  'amount-display',
]

const SCAN_ROOT = repoPath('apps/web/src')

function looksLikeMoneyFormatter(relPath: string, source: string): boolean {
  const lower = relPath.toLowerCase()
  if (MONEY_FILE_HINTS.some((h) => lower.includes(h.toLowerCase()))) return true
  if (/function\s+format(Money|Currency|Cent)/.test(source)) return true
  if (/export\s+function\s+format.*Money/.test(source)) return true
  return false
}

function checkMoneyFile(relPath: string, source: string): string[] {
  if (!looksLikeMoneyFormatter(relPath, source)) return []

  const issues: string[] = []

  if (/\/\s*10000|\*\s*0\.0001|10000\s*\)/.test(source)) {
    issues.push(`${relPath}：金额格式化函数中出现 /10000 或等价换算，疑似「万」缩写`)
  }

  const fnBlocks = source.match(
    /export function format(?:Money|Currency|Cent)[\s\S]*?(?=\nexport |\n\/\*\*|$)/g,
  )
  if (fnBlocks) {
    for (const block of fnBlocks) {
      if (/[`'"][^`'"]*万[^`'"]*[`'"]/.test(block)) {
        issues.push(`${relPath}：formatMoney/formatCurrency 函数字符串拼接含「万」`)
      }
      if (/toFixed\([^)]*\)\s*\+\s*['"]万['"]/.test(block)) {
        issues.push(`${relPath}：金额格式化使用「万」后缀`)
      }
    }
  }

  // 明确禁止 wan 展示分支（类型别名可保留，但不能有 wan 分支逻辑）
  if (/mode\s*===\s*['"]wan['"]/.test(source) || /case\s+['"]wan['"]/.test(source)) {
    issues.push(`${relPath}：仍存在 wan 展示模式分支`)
  }

  return issues
}

function main(): void {
  const issues: string[] = []

  for (const file of walkFiles(SCAN_ROOT)) {
    const rel = toRepoRelative(file)
    const source = readText(file)
    issues.push(...checkMoneyFile(rel, source))
  }

  if (issues.length > 0) {
    fail('金额格式化存在「万」缩写风险', issues)
  }

  pass('金额格式化未发现「万」缩写或 /10000 展示逻辑')
}

main()
