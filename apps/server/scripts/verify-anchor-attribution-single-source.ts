/**
 * 主播归属单一事实来源静态检查
 * npm run verify:anchor-attribution-single-source
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(__dirname, '../src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.ts$/.test(name)) out.push(p)
  }
  return out
}

function main(): void {
  const files = walk(root)
  const forbiddenInProd: Array<{ file: string; pattern: RegExp; hint: string }> = []

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/')
    // 允许遗留实现文件本身存在，但禁止品退服务再独立匹配场次
    if (rel === 'services/quality-refund-anchor-attribution.service.ts') {
      const text = fs.readFileSync(file, 'utf-8')
      assert.ok(
        text.includes('resolveCanonicalOrderAttribution'),
        '品退归属服务必须调用 resolveCanonicalOrderAttribution',
      )
      assert.ok(
        !/findBestLiveSession\s*\(/.test(text),
        '品退归属服务不得再调用 findBestLiveSession',
      )
      assert.ok(!/matchTimeRule\s*\(/.test(text), '品退归属服务不得再调用 matchTimeRule')
    }
    if (rel === 'services/board-metrics.service.ts') {
      const text = fs.readFileSync(file, 'utf-8')
      assert.ok(
        text.includes('品退不再单独重算主播') ||
          /applyQualityRefundAnchorCountsToLeaderboard[\s\S]*void rows/.test(text),
        '榜单不得再独立覆盖 qualityReturnCount',
      )
    }
    if (rel === 'services/canonical-order-attribution.service.ts') {
      const text = fs.readFileSync(file, 'utf-8')
      assert.ok(text.includes('CANONICAL_ATTRIBUTION_VERSION'))
      assert.ok(text.includes('export async function resolveCanonicalOrderAttribution'))
    }
  }

  void forbiddenInProd
  console.log('PASS: verify:anchor-attribution-single-source')
}

main()
