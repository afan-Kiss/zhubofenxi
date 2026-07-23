/**
 * 默认排班模板设置 API 验收
 * npx tsx apps/server/scripts/accept-default-schedule-templates.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  ensureScheduleTemplatesSeeded,
  listCurrentDefaultTemplatesForAdmin,
  saveCurrentDefaultTemplates,
} from '../src/services/anchor-schedule-template.service'

async function main() {
  console.log('accept-default-schedule-templates')
  await ensureScheduleTemplatesSeeded()
  const before = await listCurrentDefaultTemplatesForAdmin()
  assert.ok(before.templates.length >= 1, '应有当前生效默认排班')

  const first = before.templates[0]!
  const restored = await saveCurrentDefaultTemplates({
    asOfDate: before.date,
    templates: before.templates.map((t) => ({
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
  assert.equal(restored.templates.length, before.templates.length)

  // 完全相同的重复行应被去重后保存
  if (before.templates.length >= 1) {
    const base = before.templates[0]!
    const withDup = await saveCurrentDefaultTemplates({
      asOfDate: before.date,
      templates: [
        ...before.templates.map((t) => ({
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
        {
          anchorId: base.anchorId,
          anchorName: base.anchorName,
          shopName: base.shopName,
          liveRoomName: base.liveRoomName,
          startTime: base.startTime,
          endTime: base.endTime,
          note: base.note,
          sortOrder: 999,
        },
      ],
    })
    assert.equal(
      withDup.templates.length,
      before.templates.length,
      '提交重复行后数量应不变',
    )
  }

  // 改备注再还原（避免改直播间触发同店冲突）
  const mid = await saveCurrentDefaultTemplates({
    asOfDate: before.date,
    templates: before.templates.map((t, i) =>
      i === 0
        ? {
            id: t.id,
            anchorId: t.anchorId,
            anchorName: t.anchorName,
            shopName: t.shopName,
            liveRoomName: t.liveRoomName,
            startTime: t.startTime,
            endTime: t.endTime,
            note: '验收备注',
            sortOrder: t.sortOrder,
          }
        : {
            id: t.id,
            anchorId: t.anchorId,
            anchorName: t.anchorName,
            shopName: t.shopName,
            liveRoomName: t.liveRoomName,
            startTime: t.startTime,
            endTime: t.endTime,
            note: t.note,
            sortOrder: t.sortOrder,
          },
    ),
  })
  assert.equal(mid.templates.find((t) => t.id === first.id)?.note, '验收备注')

  await saveCurrentDefaultTemplates({
    asOfDate: before.date,
    templates: before.templates.map((t) => ({
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
  const after = await listCurrentDefaultTemplatesForAdmin(before.date)
  assert.equal(after.templates.find((t) => t.id === first.id)?.note, first.note)
  console.log(
    JSON.stringify({
      date: before.date,
      count: before.templates.length,
      sample: before.templates.map((t) => `${t.anchorName} ${t.startTime}-${t.endTime} ${t.liveRoomName}`),
      noteRoundTrip: after.templates.find((t) => t.id === first.id)?.note ?? null,
    }),
  )
  console.log('PASS accept-default-schedule-templates')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
