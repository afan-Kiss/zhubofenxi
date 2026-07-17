/**
 * 有效排班稳定身份字段验收
 * npx tsx apps/server/scripts/verify-effective-schedule-identity.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'
import { shanghaiTodayDateKey } from '../src/utils/anchor-effective-date.util'

const serverRoot = path.resolve(__dirname, '..')
const require = createRequire(__filename)

async function main() {
  console.log('verify-effective-schedule-identity\n')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhubo-eff-id-'))
  const dbUrl = `file:${path.join(dir, 'eff.db').replace(/\\/g, '/')}`
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
  const {
    listDailySchedulesForDate,
    getEffectiveSchedulesForDate,
  } = await import('../src/services/anchor-daily-schedule.service')

  const dateKey = shanghaiTodayDateKey()
  const formalName = '__TEST_EFF_ID_FORMAL__'
  const tempName = '__TEST_EFF_ID_TEMP__'
  const tempKey = `temp:${dateKey}:slot-a`

  try {
    const formal = await prisma.anchor.create({
      data: {
        name: formalName,
        color: '#123456',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-01-01',
        sortOrder: 1,
      },
    })

    await prisma.anchorScheduleTemplate.create({
      data: {
        anchorId: formal.id,
        anchorName: formalName,
        shopName: '身份测店',
        liveRoomName: '身份测店',
        startTime: '09:00',
        endTime: '12:00',
        effectiveFrom: '2026-01-01',
        enabled: true,
        sortOrder: 1,
      },
    })

    const bounds = buildScheduleBounds(dateKey, '14:00', '16:00')
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: dateKey,
        anchorId: formal.id,
        anchorName: formalName,
        shopName: '身份测店',
        liveRoomName: '身份测店',
        startAt: bounds.startAt,
        endAt: bounds.endAt,
        source: 'manual',
        enabled: true,
        isTemporaryAnchor: false,
      },
    })

    const tempBounds = buildScheduleBounds(dateKey, '18:00', '20:00')
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: dateKey,
        anchorId: null,
        anchorName: tempName,
        shopName: '身份测店',
        liveRoomName: '身份测店',
        startAt: tempBounds.startAt,
        endAt: tempBounds.endAt,
        source: 'manual',
        enabled: true,
        isTemporaryAnchor: true,
        temporaryAnchorKey: tempKey,
        anchorColorSnapshot: '#abcdef',
      },
    })

    const listed = await listDailySchedulesForDate(dateKey)
    const formalRow = listed.schedules.find((s) => s.anchorName === formalName)
    const tempRow = listed.schedules.find((s) => s.temporaryAnchorKey === tempKey)
    assert.ok(formalRow)
    assert.equal(formalRow!.anchorId, formal.id)
    assert.ok(tempRow)
    assert.equal(tempRow!.anchorId, null)
    assert.equal(tempRow!.isTemporaryAnchor, true)
    assert.equal(tempRow!.temporaryAnchorKey, tempKey)
    assert.equal(tempRow!.anchorColorSnapshot, '#abcdef')
    console.log('  ✓ listDailySchedulesForDate / effectiveRowToDto 保留身份字段')

    // 无 manual 日：走虚拟模板路径
    await prisma.anchorDailySchedule.deleteMany({ where: { scheduleDate: dateKey } })
    const virtualListed = await listDailySchedulesForDate(dateKey)
    const virtualFormal = virtualListed.schedules.find((s) => s.anchorName === formalName)
    assert.ok(virtualFormal)
    assert.equal(virtualFormal!.anchorId, formal.id)
    console.log('  ✓ 正式主播虚拟模板保留 anchorId')

    // 恢复手工日再测 getEffectiveSchedulesForDate
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: dateKey,
        anchorId: formal.id,
        anchorName: formalName,
        shopName: '身份测店',
        liveRoomName: '身份测店',
        startAt: bounds.startAt,
        endAt: bounds.endAt,
        source: 'manual',
        enabled: true,
      },
    })
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: dateKey,
        anchorId: null,
        anchorName: tempName,
        shopName: '身份测店',
        liveRoomName: '身份测店',
        startAt: tempBounds.startAt,
        endAt: tempBounds.endAt,
        source: 'manual',
        enabled: true,
        isTemporaryAnchor: true,
        temporaryAnchorKey: tempKey,
        anchorColorSnapshot: '#abcdef',
      },
    })

    const eff = await getEffectiveSchedulesForDate(dateKey)
    const manualFormal = eff.manual.find((r) => r.anchorName === formalName)
    const manualTemp = eff.manual.find((r) => r.temporaryAnchorKey === tempKey)
    assert.equal(manualFormal?.anchorId, formal.id)
    assert.equal(manualTemp?.anchorId, null)
    assert.equal(manualTemp?.temporaryAnchorKey, tempKey)
    assert.equal(manualTemp?.anchorColorSnapshot, '#abcdef')
    console.log('  ✓ getEffectiveSchedulesForDate 不丢字段')

    // 同名临时多班次仍合并（table.rows 层按有效排班产出）
    const tempBounds2 = buildScheduleBounds(dateKey, '20:00', '22:00')
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: dateKey,
        anchorId: null,
        anchorName: tempName,
        shopName: '身份测店',
        liveRoomName: '身份测店',
        startAt: tempBounds2.startAt,
        endAt: tempBounds2.endAt,
        source: 'manual',
        enabled: true,
        isTemporaryAnchor: true,
        temporaryAnchorKey: tempKey,
        anchorColorSnapshot: '#abcdef',
      },
    })
    const listed2 = await listDailySchedulesForDate(dateKey)
    const tempSlots = listed2.schedules.filter((s) => s.temporaryAnchorKey === tempKey)
    assert.ok(tempSlots.length >= 2)
    assert.ok(tempSlots.every((s) => s.anchorId == null))
    console.log('  ✓ 同名临时多班次仍按 temporaryAnchorKey 保留')

    console.log('\nPASS')
  } finally {
    await prisma.$disconnect()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
