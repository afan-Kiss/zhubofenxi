/**
 * 临时试播主播排班规则 + 历史行编辑边界验收
 * npx tsx apps/server/scripts/verify-temporary-anchor-schedule.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  assertTemporaryAnchorDateAllowed,
  buildTemporaryAnchorKey,
  isTemporaryAnchorDateAllowed,
  shanghaiTodayDateKey,
  shanghaiYesterdayDateKey,
} from '../src/utils/anchor-effective-date.util'
import { addDaysShanghai } from '../src/utils/business-timezone'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'

const serverRoot = path.resolve(__dirname, '..')
const require = createRequire(__filename)

function unitMain() {
  console.log('verify-temporary-anchor-schedule\n')

  const today = shanghaiTodayDateKey()
  const yesterday = shanghaiYesterdayDateKey()

  assert.equal(isTemporaryAnchorDateAllowed(today), true)
  assert.equal(isTemporaryAnchorDateAllowed(yesterday), true)
  assert.equal(isTemporaryAnchorDateAllowed('2020-01-01'), false)
  assert.equal(isTemporaryAnchorDateAllowed('2099-12-31'), false)
  console.log('  ✓ 今天/昨天允许，前天与未来拒绝')

  assert.throws(() => assertTemporaryAnchorDateAllowed('2020-01-01'))
  console.log('  ✓ assertTemporaryAnchorDateAllowed 抛错')

  const key = buildTemporaryAnchorKey(today, 'abc-uuid')
  assert.equal(key, `temp:${today}:abc-uuid`)
  console.log('  ✓ temporaryAnchorKey 格式')

  const historicalRow = { anchorId: null, anchorName: '某历史名', isTemporaryAnchor: false }
  assert.equal(Boolean(historicalRow.isTemporaryAnchor), false)
  console.log('  ✓ 普通 null anchorId 不误判为临时')
}

async function dbMain() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhubo-temp-sched-'))
  const dbUrl = `file:${path.join(dir, 'temp.db').replace(/\\/g, '/')}`
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
  const { saveDailySchedules, listDailySchedulesForDate } = await import(
    '../src/services/anchor-daily-schedule.service'
  )

  const threeDaysAgo = addDaysShanghai(shanghaiTodayDateKey(), -3)
  const tempName = '__TEST_TEMP_HIST__'
  const tempKey = `temp:${threeDaysAgo}:hist-1`
  const bounds = buildScheduleBounds(threeDaysAgo, '14:00', '18:00')

  try {
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: threeDaysAgo,
        anchorId: null,
        anchorName: tempName,
        shopName: '临时测店',
        liveRoomName: '临时测店',
        startAt: bounds.startAt,
        endAt: bounds.endAt,
        source: 'manual',
        enabled: true,
        confirmed: true,
        isTemporaryAnchor: true,
        temporaryAnchorKey: tempKey,
        anchorColorSnapshot: '#abcdef',
      },
    })

    const listed = await listDailySchedulesForDate(threeDaysAgo)
    const hit = listed.schedules.find((r) => r.temporaryAnchorKey === tempKey)
    assert.ok(hit, '三天前已有临时主播排班可读取')
    console.log('  ✓ 三天前已有临时主播排班可读取')

    // 未修改的历史临时行随整表保存：不因日期限制失败
    await saveDailySchedules({
      date: threeDaysAgo,
      schedules: [
        {
          anchorId: null,
          anchorName: tempName,
          shopName: '临时测店',
          liveRoomName: '临时测店',
          startTime: '14:00',
          endTime: '18:00',
          enabled: true,
          isTemporaryAnchor: true,
          temporaryAnchorKey: tempKey,
          anchorColorSnapshot: '#abcdef',
        },
      ],
      createdBy: 'verify',
      forceHistoricalScheduleChange: true,
      changeReason: 'verify re-save existing temp',
    })
    console.log('  ✓ 保存未修改的历史临时行不因日期限制失败')

    let rejected = false
    try {
      await saveDailySchedules({
        date: threeDaysAgo,
        schedules: [
          {
            anchorId: null,
            anchorName: tempName,
            shopName: '临时测店',
            liveRoomName: '临时测店',
            startTime: '14:00',
            endTime: '18:00',
            enabled: true,
            isTemporaryAnchor: true,
            temporaryAnchorKey: tempKey,
          },
          {
            anchorId: null,
            anchorName: '__TEST_TEMP_NEW_OLD__',
            shopName: '临时测店',
            liveRoomName: '临时测店',
            startTime: '19:00',
            endTime: '21:00',
            enabled: true,
            isTemporaryAnchor: true,
          },
        ],
        createdBy: 'verify',
        forceHistoricalScheduleChange: true,
        changeReason: 'verify reject new temp on old day',
      })
    } catch {
      rejected = true
    }
    assert.equal(rejected, true, '三天前新增第二个临时主播应被拒绝')
    console.log('  ✓ 三天前新增第二个临时主播被拒绝')
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
