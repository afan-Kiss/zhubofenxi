/**
 * 小白 XY 午场默认模板误停用后应自动恢复
 * npx tsx apps/server/scripts/verify-xiaobai-default-template-revive.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  ensureScheduleTemplatesSeeded,
  listCurrentDefaultTemplatesForAdmin,
  saveCurrentDefaultTemplates,
  todayShanghaiDateKey,
} from '../src/services/anchor-schedule-template.service'
import { addDaysShanghai } from '../src/utils/business-timezone'

async function main() {
  console.log('verify-xiaobai-default-template-revive')
  await ensureScheduleTemplatesSeeded()
  const dateKey = todayShanghaiDateKey()

  const xiaobai = await prisma.anchor.findFirst({
    where: {
      name: '小白',
      deletedAt: null,
      enabled: true,
      attributionMode: 'schedule',
      systemKey: null,
    },
  })
  if (!xiaobai) {
    console.log('SKIP: 本地无在职小白')
    return
  }

  const tpl = await prisma.anchorScheduleTemplate.findFirst({
    where: {
      anchorName: '小白',
      shopName: 'XY祥钰珠宝',
      startTime: '14:00',
      effectiveFrom: '2026-07-01',
    },
  })
  assert.ok(tpl, '应存在小白 XY 14:00 种子模板行')

  // 1) 仅 enabled=false、区间仍开放 → 应复活
  await prisma.anchorScheduleTemplate.update({
    where: { id: tpl.id },
    data: { enabled: false, effectiveTo: null, anchorId: xiaobai.id },
  })
  await ensureScheduleTemplatesSeeded()
  const revived = await prisma.anchorScheduleTemplate.findUnique({ where: { id: tpl.id } })
  assert.equal(revived?.enabled, true, '开放区间误停用应复活')
  assert.equal(revived?.effectiveTo, null)
  assert.equal(revived?.anchorId, xiaobai.id)

  const admin = await listCurrentDefaultTemplatesForAdmin(dateKey)
  assert.ok(
    admin.templates.some(
      (t) => t.anchorName === '小白' && t.shopName === 'XY祥钰珠宝' && t.startTime === '14:00',
    ),
    '设置页当日默认排班应含小白 XY 午场',
  )

  // 2) 设置页删除（截断 effectiveTo）→ 不应复活
  const before = await listCurrentDefaultTemplatesForAdmin(dateKey)
  const withoutXiaobai = before.templates.filter((t) => t.id !== tpl.id)
  assert.ok(withoutXiaobai.length >= 1, '删除小白后仍应有其它默认排班')
  await saveCurrentDefaultTemplates({
    asOfDate: dateKey,
    templates: withoutXiaobai.map((t) => ({
      id: t.id,
      anchorId: t.anchorId,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startTime: t.startTime,
      endTime: t.endTime,
      note: t.note,
      sortOrder: t.sortOrder,
    })),
  })
  const closed = await prisma.anchorScheduleTemplate.findUnique({ where: { id: tpl.id } })
  assert.equal(closed?.enabled, false)
  assert.equal(closed?.effectiveTo, addDaysShanghai(dateKey, -1))
  await ensureScheduleTemplatesSeeded()
  const stillClosed = await prisma.anchorScheduleTemplate.findUnique({ where: { id: tpl.id } })
  assert.equal(stillClosed?.enabled, false, '设置页删除后不得复活')

  // 还原：清掉截断并复活，再写回完整列表
  await prisma.anchorScheduleTemplate.update({
    where: { id: tpl.id },
    data: {
      enabled: true,
      effectiveTo: null,
      anchorId: xiaobai.id,
      anchorName: '小白',
      endTime: '18:30',
      liveRoomName: 'XY祥钰珠宝',
      note: '午场·XY祥钰珠宝',
      sortOrder: 30,
    },
  })
  const restoredList = [
    ...withoutXiaobai,
    {
      id: tpl.id,
      anchorId: xiaobai.id,
      anchorName: '小白',
      shopName: 'XY祥钰珠宝',
      liveRoomName: 'XY祥钰珠宝',
      startTime: '14:00',
      endTime: '18:30',
      note: '午场·XY祥钰珠宝',
      sortOrder: 30,
    },
  ]
  await saveCurrentDefaultTemplates({
    asOfDate: dateKey,
    templates: restoredList.map((t) => ({
      id: t.id,
      anchorId: t.anchorId,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startTime: t.startTime,
      endTime: t.endTime,
      note: t.note,
      sortOrder: t.sortOrder,
    })),
  })

  console.log('PASS verify-xiaobai-default-template-revive')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
