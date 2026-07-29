/**
 * 恢复 7 月初被模板重刷冲掉的午场排班（从 7/10 备份对照）。
 * 手排班日不动；仅补缺失午场，写入 source=manual + locked，防止再次被 generated 覆盖。
 *
 * 用法: npx tsx apps/server/scripts/restore-july-afternoon-schedules.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ANCHORS = {
  小白: 'cmrlmeb1x0000ninpnh2o79wm',
  小艺: 'cmrlmeb2e0002ninp6voof7ut',
  小红: 'cmrlmeb280001ninp6paz4aq9',
} as const

type Slot = {
  date: string
  anchorName: keyof typeof ANCHORS
  shopName: string
  start: string // HH:mm
  end: string
  note: string
}

/**
 * 7/1–7/2：从备份恢复午场。
 * 备份虚排曾是 小白·XY，业务确认 XY 午场应归小红；和田午场仍归小艺。
 */
const FROM_BACKUP: Slot[] = [
  {
    date: '2026-07-01',
    anchorName: '小红',
    shopName: 'XY祥钰珠宝',
    start: '14:00',
    end: '18:30',
    note: '恢复：XY午场归小红（纠正备份虚排小白）',
  },
  {
    date: '2026-07-01',
    anchorName: '小艺',
    shopName: '和田雅玉',
    start: '14:00',
    end: '18:30',
    note: '恢复：7/10备份午场·和田（模板重刷误删）',
  },
  {
    date: '2026-07-02',
    anchorName: '小红',
    shopName: 'XY祥钰珠宝',
    start: '14:00',
    end: '18:30',
    note: '恢复：XY午场归小红（纠正备份虚排小白）',
  },
  {
    date: '2026-07-02',
    anchorName: '小艺',
    shopName: '和田雅玉',
    start: '14:00',
    end: '18:30',
    note: '恢复：7/10备份午场·和田（模板重刷误删）',
  },
]

/**
 * 7/3、7/8–7/10：备份无行；按邻近手排班（7/6–7/7）惯例补：
 * XY午场→小红，和田午场→小艺
 */
const FROM_NEIGHBOR_PATTERN: Slot[] = [
  '2026-07-03',
  '2026-07-08',
  '2026-07-09',
  '2026-07-10',
].flatMap((date) => [
  {
    date,
    anchorName: '小红' as const,
    shopName: 'XY祥钰珠宝',
    start: '14:00',
    end: '18:30',
    note: '补排：邻近手排班惯例·XY午场小红（原缺行）',
  },
  {
    date,
    anchorName: '小艺' as const,
    shopName: '和田雅玉',
    start: '14:00',
    end: '18:30',
    note: '补排：邻近手排班惯例·和田午场小艺（原缺行）',
  },
])

function bounds(date: string, start: string, end: string) {
  const startAt = new Date(`${date}T${start}:00+08:00`)
  let endAt = new Date(`${date}T${end}:00+08:00`)
  if (end === '24:00') endAt = new Date(`${date}T23:59:59.999+08:00`)
  if (endAt <= startAt) endAt = new Date(endAt.getTime() + 86_400_000)
  return { startAt, endAt }
}

async function ensureSlot(slot: Slot): Promise<'created' | 'exists'> {
  const { startAt, endAt } = bounds(slot.date, slot.start, slot.end)
  const existing = await prisma.anchorDailySchedule.findFirst({
    where: {
      scheduleDate: slot.date,
      anchorName: slot.anchorName,
      shopName: slot.shopName,
      startAt,
      endAt,
    },
  })
  if (existing) return 'exists'
  // 同店同日已有覆盖该时段的手排班则跳过
  const overlap = await prisma.anchorDailySchedule.findFirst({
    where: {
      scheduleDate: slot.date,
      shopName: slot.shopName,
      enabled: true,
      isOnLeave: false,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  })
  if (overlap) {
    console.log(
      `skip overlap ${slot.date} ${slot.shopName} ${slot.start}-${slot.end} existing=${overlap.anchorName}`,
    )
    return 'exists'
  }
  await prisma.anchorDailySchedule.create({
    data: {
      scheduleDate: slot.date,
      anchorId: ANCHORS[slot.anchorName],
      anchorName: slot.anchorName,
      shopName: slot.shopName,
      liveRoomName: slot.shopName,
      startAt,
      endAt,
      source: 'manual',
      enabled: true,
      locked: true,
      confirmed: true,
      confirmedAt: new Date(),
      confirmedBy: 'restore-july-afternoon-schedules',
      note: slot.note,
      createdBy: 'restore-july-afternoon-schedules',
    },
  })
  return 'created'
}

async function main() {
  let created = 0
  let exists = 0
  for (const slot of [...FROM_BACKUP, ...FROM_NEIGHBOR_PATTERN]) {
    const r = await ensureSlot(slot)
    console.log(r, slot.date, slot.anchorName, slot.shopName, `${slot.start}-${slot.end}`)
    if (r === 'created') created += 1
    else exists += 1
  }
  console.log(JSON.stringify({ created, exists }))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
