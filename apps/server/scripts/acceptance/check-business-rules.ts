/**
 * 检查项目治理文档是否存在，且包含核心原则关键词。
 */
import { fail, fileExists, pass, readText, repoPath } from './_shared'

const REQUIRED_FILES = [
  'AGENTS.md',
  '.cursor/rules/project.mdc',
  'docs/PRODUCT_SPEC.md',
  'docs/DATA_METRICS_SPEC.md',
  'docs/UI_COPY_RULES.md',
  'docs/ACCEPTANCE_CHECKLIST.md',
] as const

const REQUIRED_PHRASE_GROUPS: Array<{ label: string; files: string[]; phrases: string[] }> = [
  {
    label: '只做直播经营',
    files: ['AGENTS.md', 'docs/PRODUCT_SPEC.md', 'docs/DATA_METRICS_SPEC.md'],
    phrases: ['直播经营', '经营 BI', '经营看板', '经营总览'],
  },
  {
    label: '不做财务',
    files: ['AGENTS.md', '.cursor/rules/project.mdc', 'docs/PRODUCT_SPEC.md'],
    phrases: ['不做财务', '不做财务对账', '不做财务', '禁止', '财务对账'],
  },
  {
    label: '不新增订单明细主菜单',
    files: ['AGENTS.md', '.cursor/rules/project.mdc', 'docs/PRODUCT_SPEC.md'],
    phrases: ['订单明细', '主菜单'],
  },
  {
    label: '金额不缩写',
    files: ['docs/DATA_METRICS_SPEC.md', 'docs/UI_COPY_RULES.md', '.cursor/rules/project.mdc'],
    phrases: ['¥10,079.90', '完整', '万'],
  },
  {
    label: '买家排行不随日期切换',
    files: ['docs/PRODUCT_SPEC.md', 'docs/DATA_METRICS_SPEC.md', 'AGENTS.md'],
    phrases: ['买家排行', '不随', '日期'],
  },
]

function fileContainsAny(filePath: string, phrases: string[]): boolean {
  const text = readText(filePath)
  return phrases.some((p) => text.includes(p))
}

function main(): void {
  const missing: string[] = []
  for (const rel of REQUIRED_FILES) {
    const abs = repoPath(rel)
    if (!fileExists(abs)) missing.push(rel)
  }
  if (missing.length > 0) {
    fail('缺少项目治理文件', missing)
  }

  const phraseIssues: string[] = []
  for (const group of REQUIRED_PHRASE_GROUPS) {
    const ok = group.files.some((rel) => {
      const abs = repoPath(rel)
      return fileExists(abs) && fileContainsAny(abs, group.phrases)
    })
    if (!ok) {
      phraseIssues.push(`文档未覆盖核心原则「${group.label}」（期望出现在 ${group.files.join(' / ')} 之一）`)
    }
  }

  if (phraseIssues.length > 0) {
    fail('治理文档内容不完整', phraseIssues)
  }

  const mdc = readText(repoPath('.cursor/rules/project.mdc'))
  if (!/alwaysApply:\s*true/.test(mdc)) {
    fail('.cursor/rules/project.mdc 必须设置 alwaysApply: true')
  }

  pass(`项目治理文件齐全（${REQUIRED_FILES.length} 个）且核心原则已写入`)
}

main()
