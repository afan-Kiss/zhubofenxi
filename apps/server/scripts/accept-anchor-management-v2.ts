/**
 * 主播管理核心规则验收（隔离测试主播，结束时软删）
 * npx tsx apps/server/scripts/accept-anchor-management-v2.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  createAnchor,
  isManualOnlyAnchor,
  softDeleteAnchor,
  listAnchorsForAdmin,
  initializeSystemAnchors,
  refreshAnchorConfigCache,
  YIFAN_SYSTEM_KEY,
  findYifanManualSystemAnchor,
  getAnchorConfigSync,
} from '../src/services/anchor.service'

async function main() {
  console.log('accept-anchor-management-v2')
  await initializeSystemAnchors()
  await refreshAnchorConfigCache()

  const yifan = findYifanManualSystemAnchor(getAnchorConfigSync())
  assert.ok(yifan)
  assert.equal(yifan.systemKey, YIFAN_SYSTEM_KEY)

  const stamp = Date.now()
  const name = `__验收主播_${stamp}`
  const created = await createAnchor({
    name,
    color: '#12B886',
    attributionMode: 'schedule',
    effectiveFrom: '2026-07-15',
    // 不传 timeRules
  })
  assert.equal(created.attributionMode, 'schedule')
  assert.equal(created.effectiveFrom, '2026-07-15')
  assert.equal(created.timeRules.length, 0)
  assert.equal(isManualOnlyAnchor(created), false)

  const all = await listAnchorsForAdmin(false)
  assert.ok(all.some((a) => a.id === created.id), '设置列表应含新主播')
  assert.ok(all.some((a) => a.systemKey === YIFAN_SYSTEM_KEY), '设置列表应含逸凡')

  // 不允许空上岗日
  let threw = false
  try {
    await createAnchor({
      name: `__验收缺日期_${stamp}`,
      attributionMode: 'schedule',
    })
  } catch {
    threw = true
  }
  assert.ok(threw, '排班主播缺上岗日应失败')

  await softDeleteAnchor(created.id)
  console.log(
    JSON.stringify({
      createdId: created.id,
      timeRuleCount: created.timeRules.length,
      isManualOnly: isManualOnlyAnchor(created),
      adminCount: all.length,
    }),
  )
  console.log('PASS accept-anchor-management-v2')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
