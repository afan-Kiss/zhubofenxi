/**
 * 主播离职日期 / 生效区间 + 事务回滚 / 影响摘要验收
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
  const { offboardAnchor } = await import('../src/services/anchor-offboard.service')
  const { getBusinessDataGenerationSync, ensureBusinessDataGenerationLoaded } = await import(
    '../src/services/business-data-generation.service'
  )

  const today = shanghaiTodayDateKey()
  const last = shanghaiYesterdayDateKey()
  const future = addDaysShanghai(today, 3)
  const name = '__TEST_OFFBOARD_TX__'

  try {
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

    await ensureBusinessDataGenerationLoaded()
    const genBefore = getBusinessDataGenerationSync().anchorMasterGeneration

    let rolled = false
    try {
      await offboardAnchor({
        id: anchor.id,
        effectiveTo: last,
        reason: 'inject',
        __verifyInjectFailureAfter: 'templates',
      })
    } catch (e) {
      rolled = String(e).includes('VERIFY_INJECT')
    }
    assert.equal(rolled, true, '应触发注入失败')

    const afterFail = await prisma.anchor.findUniqueOrThrow({ where: { id: anchor.id } })
    assert.equal(afterFail.enabled, true)
    assert.equal(afterFail.effectiveTo, null)
    const tpl = await prisma.anchorScheduleTemplate.findFirst({ where: { anchorId: anchor.id } })
    assert.ok(tpl)
    assert.equal(tpl!.enabled, true)
    assert.equal(tpl!.effectiveTo, null)
    const futLeft = await prisma.anchorDailySchedule.count({
      where: { scheduleDate: future, anchorId: anchor.id },
    })
    assert.equal(futLeft, 1, '未来排班应回滚保留')
    console.log('  ✓ 离职事务注入失败后全部回滚')

    const summary = await offboardAnchor({
      id: anchor.id,
      effectiveTo: last,
      reason: 'ok',
    })
    assert.equal(summary.anchorId, anchor.id)
    assert.equal(summary.anchorName, name)
    assert.equal(summary.effectiveTo, last)
    assert.ok(summary.truncatedTemplateCount >= 1)
    assert.ok(summary.removedFutureScheduleCount >= 1)
    assert.ok(summary.affectedDates.includes(future))
    console.log('  ✓ 离职返回影响摘要')

    await ensureBusinessDataGenerationLoaded()
    const genAfter = getBusinessDataGenerationSync().anchorMasterGeneration
    assert.ok(
      genAfter >= genBefore,
      `generation 应推进或至少不回退 before=${genBefore} after=${genAfter}`,
    )
    console.log('  ✓ 离职后 generation 可查询')
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
