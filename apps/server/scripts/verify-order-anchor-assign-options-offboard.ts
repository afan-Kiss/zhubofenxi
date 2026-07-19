/**
 * 指派选项不得再出现已离职小红/小艺，且禁止 extra-*
 * npx tsx apps/server/scripts/verify-order-anchor-assign-options-offboard.ts
 */
import assert from 'node:assert/strict'
import {
  setAnchorConfigCacheForTests,
  setAttributionLifecycleExtrasForTests,
} from '../src/services/anchor.service'
import type { AnchorConfig } from '../src/types/analysis'

async function main() {
  const cfg: AnchorConfig = {
    anchors: [
      {
        id: 'a-zijie',
        name: '子杰',
        color: '#f00',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      {
        id: 'a-chengcheng',
        name: '橙橙',
        color: '#0af',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-07-17',
        effectiveTo: null,
      },
      {
        id: 'a-xiaobai',
        name: '小白',
        color: '#3B82F6',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-06-18',
        effectiveTo: null,
      },
    ],
    timeRules: [],
  }
  setAnchorConfigCacheForTests(cfg)
  setAttributionLifecycleExtrasForTests([
    {
      id: 'a-xiaohong',
      name: '小红',
      color: '#f88',
      enabled: false,
      attributionMode: 'schedule',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-07-16',
      deletedAt: '2026-07-17T00:00:00.000Z',
    },
    {
      id: 'a-xiaoyi',
      name: '小艺',
      color: '#88f',
      enabled: false,
      attributionMode: 'schedule',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-07-16',
      deletedAt: '2026-07-17T00:00:00.000Z',
    },
  ])

  const {
    buildOrderAnchorAssignOptions,
    resolveManualAssignAnchorIdentity,
  } = await import('../src/services/order-anchor-manual-override.service')

  const opts = buildOrderAnchorAssignOptions('2026-07-19')
  const names = opts.map((o) => o.name)
  assert.ok(names.includes('橙橙'), '应含橙橙')
  assert.ok(names.includes('小白'), '应含小白')
  assert.ok(!names.includes('小红'), `不应含小红: ${names.join(',')}`)
  assert.ok(!names.includes('小艺'), `不应含小艺: ${names.join(',')}`)
  assert.ok(!opts.some((o) => o.id.startsWith('extra-')), '禁止 extra-*')
  console.log('  ✓ 指派选项无小红/小艺、无 extra-*')

  // 离职当天仍可选
  const lastDay = buildOrderAnchorAssignOptions('2026-07-16')
  assert.ok(lastDay.some((o) => o.name === '小红'))
  assert.ok(lastDay.some((o) => o.name === '小艺'))
  console.log('  ✓ 离职当天选项仍含小红/小艺')

  assert.throws(
    () => resolveManualAssignAnchorIdentity('小红'),
    /不在岗|不存在/,
  )
  assert.doesNotThrow(() => resolveManualAssignAnchorIdentity('橙橙'))
  console.log('  ✓ 今日提交小红被拒绝，橙橙可通过')

  console.log('\nALL PASS')
  setAnchorConfigCacheForTests(null)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
