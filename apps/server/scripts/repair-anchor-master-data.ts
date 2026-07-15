/**
 * 补齐 Anchor 主表（从排班模板 / 日排班 / 代码种子发现姓名）
 * 默认 dry-run；加 --apply 才写入。
 *
 * 规则：
 * - 普通主播 attributionMode=schedule
 * - 不创建 00:00–23:59 timeRules
 * - 不重复创建同名
 * - 逸凡不在此脚本创建（走 systemKey 初始化）
 * - 回填 schedule.anchorId
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { NEW_SCHEDULE_TEMPLATE_SEEDS_20260701 } from '../src/services/anchor-schedule-template.service'
import {
  initializeSystemAnchors,
  refreshAnchorConfigCache,
  YIFAN_SYSTEM_KEY,
} from '../src/services/anchor.service'
import { ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE } from '../src/config/anchor-schedule.constants'

config({ path: path.resolve(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')

const DEFAULT_COLORS = ['#FF2442', '#FF8A3D', '#22C55E', '#3B82F6', '#EC4899', '#A855F7', '#14B8A6']

function normalize(name: string | null | undefined): string {
  return (name ?? '').trim()
}

async function collectMissingNames(): Promise<string[]> {
  const [templates, daily] = await Promise.all([
    prisma.anchorScheduleTemplate.findMany({ select: { anchorName: true } }),
    prisma.anchorDailySchedule.findMany({ select: { anchorName: true }, distinct: ['anchorName'] }),
  ])
  const names = new Set<string>()
  for (const t of templates) {
    const n = normalize(t.anchorName)
    if (n) names.add(n)
  }
  for (const d of daily) {
    const n = normalize(d.anchorName)
    if (n) names.add(n)
  }
  for (const s of NEW_SCHEDULE_TEMPLATE_SEEDS_20260701) {
    names.add(s.anchorName)
  }
  // 勿用显示名处理逸凡
  names.delete('逸凡')

  const existing = await prisma.anchor.findMany({
    where: { deletedAt: null },
    select: { name: true, systemKey: true },
  })
  const have = new Set(existing.filter((a) => a.systemKey !== YIFAN_SYSTEM_KEY).map((a) => a.name))
  return [...names].filter((n) => !have.has(n)).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function guessEffectiveFrom(name: string): string {
  if (name === '小白') return '2026-06-18'
  return ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE
}

async function backfillScheduleAnchorIds(): Promise<{ templates: number; daily: number }> {
  const anchors = await prisma.anchor.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  })
  const byName = new Map(anchors.map((a) => [a.name, a.id]))
  let templates = 0
  let daily = 0
  const tplRows = await prisma.anchorScheduleTemplate.findMany({
    where: { OR: [{ anchorId: null }, { anchorId: '' }] },
    select: { id: true, anchorName: true },
  })
  for (const row of tplRows) {
    const id = byName.get(normalize(row.anchorName))
    if (!id) continue
    if (APPLY) {
      await prisma.anchorScheduleTemplate.update({ where: { id: row.id }, data: { anchorId: id } })
    }
    templates++
  }
  const dailyRows = await prisma.anchorDailySchedule.findMany({
    where: { OR: [{ anchorId: null }, { anchorId: '' }] },
    select: { id: true, anchorName: true },
  })
  for (const row of dailyRows) {
    const id = byName.get(normalize(row.anchorName))
    if (!id) continue
    if (APPLY) {
      await prisma.anchorDailySchedule.update({ where: { id: row.id }, data: { anchorId: id } })
    }
    daily++
  }
  return { templates, daily }
}

async function main(): Promise<void> {
  console.log(`repair-anchor-master-data (${APPLY ? 'APPLY' : 'dry-run'})\n`)
  await initializeSystemAnchors()

  const before = await prisma.anchor.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      attributionMode: true,
      systemKey: true,
      color: true,
      effectiveFrom: true,
      sortOrder: true,
    },
  })
  console.log('修复前主表:')
  for (const a of before) {
    console.log(
      `  - ${a.name} mode=${a.attributionMode} key=${a.systemKey ?? '—'} from=${a.effectiveFrom ?? '—'} color=${a.color ?? '—'}`,
    )
  }

  const missing = await collectMissingNames()
  console.log(`\n待补齐普通主播: ${missing.join('、') || '无'}`)

  const maxSort = before.reduce((m, a) => Math.max(m, a.sortOrder), -1)
  const created: string[] = []
  for (let i = 0; i < missing.length; i++) {
    const name = missing[i]!
    const color = DEFAULT_COLORS[(maxSort + 1 + i) % DEFAULT_COLORS.length]!
    const effectiveFrom = guessEffectiveFrom(name)
    console.log(
      `  → 将创建 ${name} schedule 无 timeRules effectiveFrom=${effectiveFrom} color=${color}`,
    )
    if (APPLY) {
      await prisma.anchor.create({
        data: {
          name,
          color,
          enabled: true,
          sortOrder: maxSort + 1 + i,
          attributionMode: 'schedule',
          effectiveFrom,
          // 故意不创建 timeRules
        },
      })
      created.push(name)
    }
  }

  const link = await backfillScheduleAnchorIds()
  console.log(
    `\n排班回填 anchorId: templates=${link.templates} daily=${link.daily}${APPLY ? '（已写入）' : '（dry-run）'}`,
  )

  if (APPLY) {
    await refreshAnchorConfigCache()
  }

  const after = await prisma.anchor.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      name: true,
      attributionMode: true,
      systemKey: true,
      effectiveFrom: true,
      color: true,
      _count: { select: { timeRules: true } },
    },
  })
  console.log('\n修复后主表:')
  for (const a of after) {
    console.log(
      `  - ${a.name} mode=${a.attributionMode} key=${a.systemKey ?? '—'} from=${a.effectiveFrom ?? '—'} rules=${a._count.timeRules} color=${a.color ?? '—'}`,
    )
  }
  console.log(`\n本次新建: ${created.join('、') || '无（dry-run 或已齐全）'}`)
  if (!APPLY) console.log('\n提示: 加 --apply 执行写入')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
