/**
 * 运营报表大白话文案验收
 * 用法: npm run accept:operations-plain-language
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../web/src')
const SCAN_DIRS = [
  path.join(ROOT, 'pages/operations'),
  path.join(ROOT, 'components/operations'),
]

const FORBIDDEN = [
  'dataQuality',
  'businessInsights',
  'sampleTooSmall',
  'insufficient_data',
  'rankReason',
  'evidence',
  'confidence',
  'actionState',
  'validAmountYuan',
  'soldOrderCount',
  'buyerCount',
  'productReturnRate',
  'followerConversionRate',
  'GMV',
]

const ALLOWLIST = new Set([
  'operationPlainText.ts',
  'operationsReportTypes.ts',
])

function collectTsxFiles(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) out.push(...collectTsxFiles(full))
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

function isSkippableLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (t.startsWith('import ')) return true
  if (t.startsWith('export type') || t.startsWith('export interface')) return true
  if (t.startsWith('type ') || t.startsWith('interface ')) return true
  if (t.includes('Record<') || t.includes(' keyof ')) return true
  if (/[\w]+\.(validAmountYuan|soldOrderCount|buyerCount|rankReason|dataQuality|businessInsights|actionState|productReturnRate|followerConversionRate)/.test(t)) {
    return true
  }
  if (/sampleTooSmall=|dataQuality=|businessInsights=|insights=|sampleTooSmall\?/.test(t)) {
    return true
  }
  if (t.includes('insights?.') || t.includes('report.')) return true
  return false
}

function lineHasForbiddenUserText(line: string, word: string): boolean {
  if (/\b\w+\.\w+/.test(line) && line.includes(`.${word}`)) return false
  if (new RegExp(`\\b${word}\\s*[=:?]`).test(line)) return false
  if (line.includes(`<${word}`) || line.includes(`${word}>`)) return false
  if (line.trim().startsWith('//')) return false
  const strings = line.match(/'[^']*'|"[^"]*"/g) ?? []
  return strings.some((s) => s.includes(word))
}

function scanFile(filePath: string, issues: string[]) {
  if (ALLOWLIST.has(path.basename(filePath))) return
  const rel = path.relative(path.resolve(__dirname, '../..'), filePath).replace(/\\/g, '/')
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (isSkippableLine(line)) continue
    for (const word of FORBIDDEN) {
      if (lineHasForbiddenUserText(line, word)) {
        issues.push(`${rel}:${i + 1} 含禁用词「${word}」→ ${line.trim().slice(0, 80)}`)
      }
    }
  }
}

function main() {
  const issues: string[] = []
  for (const dir of SCAN_DIRS) {
    for (const file of collectTsxFiles(dir)) {
      scanFile(file, issues)
    }
  }
  if (issues.length > 0) {
    console.error('[operations-plain-language-acceptance] FAIL')
    for (const i of issues.slice(0, 30)) console.error(`  - ${i}`)
    if (issues.length > 30) console.error(`  ... 还有 ${issues.length - 30} 条`)
    process.exit(1)
  }
  console.log('[operations-plain-language-acceptance] OK')
}

main()
