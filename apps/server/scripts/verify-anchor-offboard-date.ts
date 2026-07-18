/**
 * 主播离职日期 / 生效区间 + 事务回滚 / 审计同事务 / 重新启用语义验收
 * npx tsx apps/server/scripts/verify-anchor-offboard-date.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  assertValidOffboardDate,
  isAnchorEffectiveOnDate,
  isOffboardDateMissing,
  shanghaiTodayDateKey,
  shanghaiYesterdayDateKey,
  assertTemporaryAnchorDateAllowed,
} from '../src/utils/anchor-effective-date.util'
import { addDaysShanghai } from '../src/utils/business-timezone'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'

const serverRoot = path.resolve(__dirname, '..')
const require = createRequire(__filename)

function unitMain() {
  console.log('verify-anchor-offboard-date\n')

  assert.equal(
    isAnchorEffectiveOnDate({ effectiveFrom: '2026-01-01', effectiveTo: '2026-07-17' }, '2026-07-17'),
    true,
  )
  console.log('  ✓ 离职日期当天仍有效')

  assert.equal(
    isAnchorEffectiveOnDate({ effectiveFrom: '2026-01-01', effectiveTo: '2026-07-17' }, '2026-07-18'),
    false,
  )
  console.log('  ✓ 离职次日不可用')

  assert.equal(
    isAnchorEffectiveOnDate(
      { effectiveFrom: '2026-01-01', effectiveTo: '2026-07-17', enabled: false },
      '2026-07-16',
    ),
    true,
  )
  console.log('  ✓ 历史日不受 enabled=false 影响')

  assert.equal(
    isAnchorEffectiveOnDate({ effectiveFrom: '2026-07-10', effectiveTo: null }, '2026-07-09'),
    false,
  )
  console.log('  ✓ 上岗日前不可用')

  assert.equal(isOffboardDateMissing({ enabled: false, effectiveTo: null }), true)
  assert.equal(isOffboardDateMissing({ enabled: false, effectiveTo: '2026-07-17' }), false)
  console.log('  ✓ 缺离职日期检测')

  const { shouldPadEmptyAnchorSlot } = require('../src/services/anchor-performance-attribution.service') as typeof import('../src/services/anchor-performance-attribution.service')
  assert.equal(shouldPadEmptyAnchorSlot(null, '2026-07-18'), false)
  assert.equal(
    shouldPadEmptyAnchorSlot({ enabled: false, effectiveTo: null }, '2026-07-18'),
    false,
  )
  assert.equal(
    shouldPadEmptyAnchorSlot(
      { enabled: false, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-17' },
      '2026-07-18',
    ),
    false,
  )
  assert.equal(
    shouldPadEmptyAnchorSlot(
      { enabled: false, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-17' },
      '2026-07-17',
    ),
    true,
  )
  assert.equal(
    shouldPadEmptyAnchorSlot({ enabled: true, effectiveFrom: null, effectiveTo: null }, '2026-07-18'),
    true,
  )
  console.log('  ✓ 空卡补位：已删除/离职次日/缺离职日不补')

  assert.equal(
    assertValidOffboardDate({ effectiveTo: '2026-07-17', effectiveFrom: '2026-01-01' }),
    '2026-07-17',
  )
  assert.throws(() => assertValidOffboardDate({ effectiveTo: '', effectiveFrom: null }))
  assert.throws(() =>
    assertValidOffboardDate({ effectiveTo: '2026-01-01', effectiveFrom: '2026-07-17' }),
  )
  console.log('  ✓ 离职日期校验')

  const { canScheduleFormalAnchorOnDate } = require('../src/services/anchor-offboard.service') as typeof import('../src/services/anchor-offboard.service')
  const blocked = canScheduleFormalAnchorOnDate(
    {
      enabled: false,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-07-17',
      attributionMode: 'schedule',
    },
    '2026-07-18',
  )
  assert.equal(blocked.ok, false)
  assert.ok(blocked.message?.includes('2026-07-17'))
  console.log('  ✓ 离职后排班拒绝')

  const missing = canScheduleFormalAnchorOnDate(
    { enabled: false, effectiveTo: null, attributionMode: 'schedule' },
    '2026-07-18',
  )
  assert.equal(missing.ok, false)
  assert.ok(missing.message?.includes('待补录'))
  console.log('  ✓ 缺离职日期禁止新排班')

  const today = shanghaiTodayDateKey()
  const yesterday = shanghaiYesterdayDateKey()
  assertTemporaryAnchorDateAllowed(today)
  assertTemporaryAnchorDateAllowed(yesterday)
  assert.throws(() => assertTemporaryAnchorDateAllowed('2099-01-01'))
  console.log(`  ✓ 临时主播仅允许今天(${today})/昨天(${yesterday})`)
}

async function seedAnchor(prisma: import('@prisma/client').PrismaClient, name: string) {
  const today = shanghaiTodayDateKey()
  const last = shanghaiYesterdayDateKey()
  const future = addDaysShanghai(today, 3)
  const anchor = await prisma.anchor.create({
    data: {
      name,
      color: '#111111',
      enabled: true,
      attributionMode: 'schedule',
      effectiveFrom: addDaysShanghai(last, -10),
      sortOrder: 50,
    },
  })
  await prisma.anchorScheduleTemplate.create({
    data: {
      anchorId: anchor.id,
      anchorName: name,
      shopName: '离职测店',
      liveRoomName: '离职测店',
      startTime: '09:00',
      endTime: '12:00',
      effectiveFrom: addDaysShanghai(last, -10),
      effectiveTo: null,
      enabled: true,
      sortOrder: 1,
    },
  })
  const fut = buildScheduleBounds(future, '10:00', '12:00')
  await prisma.anchorDailySchedule.create({
    data: {
      scheduleDate: future,
      anchorId: anchor.id,
      anchorName: name,
      shopName: '离职测店',
      liveRoomName: '离职测店',
      startAt: fut.startAt,
      endAt: fut.endAt,
      source: 'manual',
      enabled: true,
    },
  })
  return { anchor, last, future }
}

async function assertFullyRolledBack(
  prisma: import('@prisma/client').PrismaClient,
  anchorId: string,
  future: string,
) {
  const afterFail = await prisma.anchor.findUniqueOrThrow({ where: { id: anchorId } })
  assert.equal(afterFail.enabled, true)
  assert.equal(afterFail.effectiveTo, null)
  const tpl = await prisma.anchorScheduleTemplate.findFirst({ where: { anchorId } })
  assert.ok(tpl)
  assert.equal(tpl!.enabled, true)
  assert.equal(tpl!.effectiveTo, null)
  const futLeft = await prisma.anchorDailySchedule.count({
    where: { scheduleDate: future, anchorId },
  })
  assert.equal(futLeft, 1)
  const logs = await prisma.operationLog.count({
    where: {
      OR: [
        { action: 'anchor_offboard' },
        { action: 'anchor_offboard_date_patch' },
        { action: 'anchor_reinstate' },
      ],
      metaJson: { contains: anchorId },
    },
  })
  assert.equal(logs, 0)
}

async function dbMain() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhubo-offboard-'))
  const dbUrl = `file:${path.join(dir, 'offboard.db').replace(/\\/g, '/')}`
  process.env.DATABASE_URL = dbUrl
  const env = { ...process.env, DATABASE_URL: dbUrl }
  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: serverRoot,
    env,
    encoding: 'utf8',
    shell: true,
  })
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr)
    throw new Error('migrate deploy failed')
  }

  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}apps${path.sep}server${path.sep}src${path.sep}`) ||
      key.includes('@prisma')
    ) {
      delete require.cache[key]
    }
  }

  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  const { offboardAnchor, reinstateAnchor, patchOffboardDate } = await import(
    '../src/services/anchor-offboard.service'
  )

  try {
    for (const stage of ['anchor', 'templates', 'schedules', 'audit'] as const) {
      const { anchor, last, future } = await seedAnchor(prisma, `__TEST_OFFBOARD_${stage}__`)
      let rolled = false
      try {
        await offboardAnchor({
          id: anchor.id,
          effectiveTo: last,
          reason: 'inject',
          __verifyInjectFailureAfter: stage,
        })
      } catch (e) {
        rolled = String(e).includes('VERIFY_INJECT')
      }
      assert.equal(rolled, true, `${stage} 应触发注入失败`)
      await assertFullyRolledBack(prisma, anchor.id, future)
      console.log(`  ✓ 注入失败(${stage}) 后 Anchor/模板/排班/审计全部回滚`)
    }

    {
      const { anchor, last, future } = await seedAnchor(prisma, '__TEST_OFFBOARD_OK__')
      const summary = await offboardAnchor({
        id: anchor.id,
        effectiveTo: last,
        reason: 'ok',
      })
      assert.equal(summary.effectiveTo, last)
      assert.ok(summary.truncatedTemplateCount >= 1)
      assert.ok(summary.removedFutureScheduleCount >= 1)
      assert.ok(summary.affectedDates.includes(future))
      const log = await prisma.operationLog.findFirst({
        where: { action: 'anchor_offboard', metaJson: { contains: anchor.id } },
        orderBy: { createdAt: 'desc' },
      })
      assert.ok(log)
      assert.notEqual(log!.action, 'unknown')
      const after = await prisma.anchor.findUniqueOrThrow({ where: { id: anchor.id } })
      assert.equal(after.enabled, false)
      assert.equal(after.effectiveTo, last)
      console.log('  ✓ 成功离职：业务变更与审计同时存在，action=anchor_offboard')
    }

    {
      const { anchor, last } = await seedAnchor(prisma, '__TEST_OFFBOARD_PATCH__')
      await prisma.anchor.update({
        where: { id: anchor.id },
        data: { enabled: false, effectiveTo: null },
      })
      await patchOffboardDate({
        id: anchor.id,
        effectiveTo: last,
        reason: '补录',
      })
      const log = await prisma.operationLog.findFirst({
        where: { action: 'anchor_offboard_date_patch', metaJson: { contains: anchor.id } },
      })
      assert.ok(log)
      console.log('  ✓ 补录离职日期：审计 action=anchor_offboard_date_patch')
    }

    {
      const { anchor, last } = await seedAnchor(prisma, '__TEST_REINSTATE_OK__')
      await offboardAnchor({ id: anchor.id, effectiveTo: last, reason: 'leave' })
      const result = await reinstateAnchor({ id: anchor.id })
      assert.equal(result.enabled, true)
      assert.equal(result.effectiveTo, null)
      assert.equal(result.templatesRestored, false)
      assert.equal(result.schedulesRestored, false)
      assert.ok(result.warning.includes('不会自动恢复'))
      const after = await prisma.anchor.findUniqueOrThrow({ where: { id: anchor.id } })
      assert.equal(after.enabled, true)
      assert.equal(after.effectiveTo, null)
      const log = await prisma.operationLog.findFirst({
        where: { action: 'anchor_reinstate', metaJson: { contains: anchor.id } },
      })
      assert.ok(log)
      console.log('  ✓ 重新启用：Anchor+审计成功，templatesRestored/schedulesRestored=false')
    }

    {
      const { anchor, last } = await seedAnchor(prisma, '__TEST_REINSTATE_FAIL__')
      await offboardAnchor({ id: anchor.id, effectiveTo: last, reason: 'leave' })
      let rolled = false
      try {
        await reinstateAnchor({
          id: anchor.id,
          __verifyInjectFailureAfter: 'audit',
        })
      } catch (e) {
        rolled = String(e).includes('VERIFY_INJECT')
      }
      assert.equal(rolled, true)
      const after = await prisma.anchor.findUniqueOrThrow({ where: { id: anchor.id } })
      assert.equal(after.enabled, false)
      assert.equal(after.effectiveTo, last)
      const reinstateLogs = await prisma.operationLog.count({
        where: { action: 'anchor_reinstate', metaJson: { contains: anchor.id } },
      })
      assert.equal(reinstateLogs, 0)
      console.log('  ✓ 重新启用审计失败 → Anchor 恢复操作回滚')
    }
  } finally {
    await prisma.$disconnect()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  unitMain()
  await dbMain()
  console.log('\nPASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
