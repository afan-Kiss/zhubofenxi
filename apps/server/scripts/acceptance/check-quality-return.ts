/**
 * 轻量静态检查：服务端是否存在品退/商品问题识别相关逻辑。
 */
import {
  fail,
  pass,
  readText,
  repoPath,
  toRepoRelative,
  walkFiles,
} from './_shared'

const REQUIRED_KEYWORD_GROUPS: Array<{ label: string; patterns: RegExp[] }> = [
  {
    label: '官方品退/品质问题接口',
    patterns: [/qualityBadCase/i, /quality-badcase/i, /官方品退/, /品质负反馈/],
  },
  {
    label: '商品问题/质量问题识别',
    patterns: [/商品问题/, /质量问题/, /qualityRefund/i, /strictQualityRefund/i],
  },
  {
    label: '售后原因/品退交叉',
    patterns: [/售后原因/, /品退/, /quality-refund/i],
  },
]

function main(): void {
  const root = repoPath('apps/server/src')
  const files = walkFiles(root)
  const corpus = files.map((f) => readText(f)).join('\n')
  const missing: string[] = []

  for (const group of REQUIRED_KEYWORD_GROUPS) {
    const hit = group.patterns.some((re) => re.test(corpus))
    if (!hit) missing.push(group.label)
  }

  if (missing.length > 0) {
    fail('服务端缺少品退/商品问题相关静态逻辑痕迹', missing)
  }

  const sampleFiles = files
    .filter((f) => /quality|品退|badcase/i.test(toRepoRelative(f)))
    .slice(0, 5)
    .map((f) => toRepoRelative(f))

  pass(
    `品退相关逻辑静态检查通过（示例文件：${sampleFiles.join('、') || 'quality-badcase 系列'}）`,
  )
}

main()
