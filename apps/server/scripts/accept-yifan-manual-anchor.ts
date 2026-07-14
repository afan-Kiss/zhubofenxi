/**
 * 逸凡 / 仅手动归属 — 行为验收（需本地 DB；库不可用时跳过写库用例）
 * 运行：npx tsx scripts/accept-yifan-manual-anchor.ts
 */
import assert from 'node:assert/strict'
import type { AnchorConfig } from '../src/types/analysis'
import { matchTimeRule } from '../src/services/anchor-rules.service'
import {
  isManualOnlyAnchor,
  isAutoAttributableAnchorName,
  setAnchorConfigCacheForTests,
  refreshAnchorConfigCache,
  softDeleteAnchor,
  updateAnchor,
  initializeSystemAnchors,
  YIFAN_SYSTEM_KEY,
} from '../src/services/anchor.service'
import { ensureAnchorPerformanceLeaderboardSlots } from '../src/services/anchor-performance-attribution.service'
import { prisma } from '../src/lib/prisma'

const manualConfig: AnchorConfig = {
  anchors: [
    {
      id: 'a-zijie',
      name: '子杰',
      color: '#f00',
      enabled: true,
      attributionMode: 'schedule',
    },
    {
      id: 'a-yifan',
      name: '逸凡',
      color: '#6366f1',
      enabled: true,
      systemKey: 'YIFAN_MANUAL',
      attributionMode: 'manual',
    },
  ],
  timeRules: [
    {
      id: 'r1',
      name: '子杰全天',
      startTime: '00:00',
      endTime: '23:59',
      anchorId: 'a-zijie',
      enabled: true,
    },
    {
      id: 'r2',
      name: '逸凡误配',
      startTime: '00:00',
      endTime: '23:59',
      anchorId: 'a-yifan',
      enabled: true,
    },
  ],
}

async function runStaticCases() {
  setAnchorConfigCacheForTests(manualConfig)
  try {
    const hit = matchTimeRule(new Date('2026-07-14T12:00:00+08:00'), manualConfig)
    assert.ok(hit, '应命中自动主播时段')
    assert.equal(hit!.anchor.name, '子杰', '不应把时段归属到仅手动主播')

    assert.equal(isManualOnlyAnchor({ attributionMode: 'manual' }), true)
    assert.equal(
      isManualOnlyAnchor({ attributionMode: 'schedule', timeRules: [{ enabled: true }] }),
      false,
    )
    assert.equal(isAutoAttributableAnchorName('逸凡'), false)
    assert.equal(isAutoAttributableAnchorName('子杰'), true)

    const slots = ensureAnchorPerformanceLeaderboardSlots(
      [
        {
          anchorId: 'a-zijie',
          anchorName: '子杰',
          gmv: 100,
          totalGmv: 100,
          orderCount: 1,
          paidOrderCount: 1,
          actualSignedAmount: 80,
          signedOrderCount: 1,
          returnAmount: 0,
          returnCount: 0,
          color: '#f00',
        } as never,
      ],
      '2026-07-14',
    )
    assert.ok(
      slots.map((s) => s.anchorName).includes('逸凡'),
      '零业绩时也要保留仅手动归属主播空卡',
    )
    console.log('  static cases: OK')
  } finally {
    setAnchorConfigCacheForTests(null)
  }
}

async function runDbCases() {
  const hasColumn = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("Anchor")`,
  ).catch(() => [] as Array<{ name: string }>)
  const cols = new Set(hasColumn.map((c) => c.name))
  if (!cols.has('systemKey') || !cols.has('attributionMode')) {
    console.log('  db cases: SKIP (schema 未含 systemKey/attributionMode，请先 prisma db push)')
    return
  }

  await initializeSystemAnchors()
  await initializeSystemAnchors()
  const rows = await prisma.anchor.findMany({
    where: { systemKey: YIFAN_SYSTEM_KEY },
  })
  assert.equal(rows.length, 1, '重复初始化不可产生多个系统主播')
  const yifan = rows[0]!
  assert.equal(yifan.attributionMode, 'manual')

  // refresh 只读：记下启用态，refresh 后不变
  const beforeEnabled = yifan.enabled
  await prisma.anchor.update({
    where: { id: yifan.id },
    data: { enabled: false },
  })
  await refreshAnchorConfigCache()
  const afterRefresh = await prisma.anchor.findUniqueOrThrow({ where: { id: yifan.id } })
  assert.equal(afterRefresh.enabled, false, '缓存刷新不得强制启用系统主播')
  await prisma.anchor.update({
    where: { id: yifan.id },
    data: { enabled: beforeEnabled },
  })

  await assert.rejects(
    () => softDeleteAnchor(yifan.id),
    /系统主播不可删除/,
  )

  await assert.rejects(
    () =>
      updateAnchor(yifan.id, {
        defaultLiveRoomName: '某个直播间',
      }),
    /不可配置默认直播间/,
  )

  await assert.rejects(
    () =>
      updateAnchor(yifan.id, {
        timeRules: [{ startTime: '00:00', endTime: '12:00', enabled: true }],
      }),
    /不可配置归属时间段/,
  )

  const renamed = `逸凡验收_${Date.now().toString(36)}`
  await updateAnchor(yifan.id, { name: renamed })
  await initializeSystemAnchors()
  const afterRename = await prisma.anchor.findMany({ where: { systemKey: YIFAN_SYSTEM_KEY } })
  assert.equal(afterRename.length, 1, '改名后初始化不得新建第二个系统主播')
  assert.equal(afterRename[0]!.name, renamed)
  await updateAnchor(yifan.id, { name: '逸凡' })

  console.log('  db cases: OK')
}

async function main() {
  console.log('accept-yifan-manual-anchor')
  await runStaticCases()
  try {
    await runDbCases()
  } catch (e) {
    console.error('  db cases: FAIL', e)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
  if (!process.exitCode) console.log('accept-yifan-manual-anchor: OK')
}

void main()
