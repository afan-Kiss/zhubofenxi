/**
 * 只读诊断：主播主数据分裂
 * 用法: npx tsx apps/server/scripts/diagnose-anchor-master-data.ts
 *
 * 不修改任何数据。输出 Anchor 主表、其它来源差集、硬编码命中分类。
 */
import path from 'node:path'
import fs from 'node:fs'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { NEW_SCHEDULE_TEMPLATE_SEEDS_20260701 } from '../src/services/anchor-schedule-template.service'
import { YIFAN_SYSTEM_KEY } from '../src/services/anchor.service'

config({ path: path.resolve(__dirname, '../.env') })

const HARDCODED_NAMES = ['子杰', '飞云', '小红', '小艺', '小白', '逸凡'] as const

const SCAN_ROOTS = [
  path.resolve(__dirname, '../../web/src'),
  path.resolve(__dirname, '../src'),
  path.resolve(__dirname, '../../docs'),
]

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim()
}

function collectNames(values: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>()
  for (const v of values) {
    const n = normalizeName(v)
    if (n) set.add(n)
  }
  return set
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort((x, y) => x.localeCompare(y, 'zh-CN'))
}

type HitClass =
  | '合法历史迁移/模板种子'
  | '合法历史验收脚本'
  | 'UI固定列表/槽位'
  | '颜色映射/硬编码色'
  | '默认配置/种子主数据'
  | '其它业务文案或杂项'

function classifyHit(file: string, line: string): HitClass {
  const f = file.replace(/\\/g, '/')
  const l = line
  if (
    f.includes('anchor-schedule-template') ||
    f.includes('anchor-performance-attribution') ||
    f.includes('anchor-xiaobai') ||
    f.includes('default-anchor-config') ||
    f.includes('ensureAnchorsSeeded') ||
    (f.includes('anchor.service') && (l.includes('子杰') || l.includes('飞云') || l.includes('逸凡')))
  ) {
    if (f.includes('default-anchor-config') || (f.includes('anchor.service') && l.includes('ensure'))) {
      return '默认配置/种子主数据'
    }
    return '合法历史迁移/模板种子'
  }
  if (f.includes('/scripts/') || f.includes('acceptance') || f.includes('verify-') || f.includes('accept-')) {
    return '合法历史验收脚本'
  }
  if (
    f.includes('anchor-session-assign-options') ||
    f.includes('FIXED_SESSION') ||
    f.includes('anchor-test-id') ||
    l.includes('FIXED_SESSION') ||
    l.includes('固定主播')
  ) {
    return 'UI固定列表/槽位'
  }
  if (
    f.includes('AnchorTrend') ||
    l.includes('ANCHOR_COLORS') ||
    l.includes('#f43f5e') ||
    l.includes('#FF2442')
  ) {
    return '颜色映射/硬编码色'
  }
  return '其它业务文案或杂项'
}

function scanHardcodedNames(): Array<{
  name: string
  file: string
  line: number
  text: string
  klass: HitClass
}> {
  const hits: Array<{
    name: string
    file: string
    line: number
    text: string
    klass: HitClass
  }> = []

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('_tmp')) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx|js|jsx|md)$/.test(ent.name)) continue
      let content: string
      try {
        content = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const lines = content.split(/\r?\n/)
      lines.forEach((text, idx) => {
        for (const name of HARDCODED_NAMES) {
          if (!text.includes(name)) continue
          // skip Chinese UI copy that mentions 小红书 etc when scanning 小红 alone carefully
          if (name === '小红' && /小红书/.test(text) && !new RegExp(`小红(?!书)`).test(text)) {
            continue
          }
          hits.push({
            name,
            file: path.relative(path.resolve(__dirname, '../../..'), full),
            line: idx + 1,
            text: text.trim().slice(0, 160),
            klass: classifyHit(full, text),
          })
        }
      })
    }
  }

  for (const root of SCAN_ROOTS) walk(root)
  // also template + attribution in server scripts lightly already covered
  walk(path.resolve(__dirname))
  return hits
}

async function main(): Promise<void> {
  console.log('=== diagnose-anchor-master-data（只读）===\n')

  const anchors = await prisma.anchor.findMany({
    include: { timeRules: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  console.log(`## 1. Anchor 主表（共 ${anchors.length} 条，含软删）\n`)
  for (const a of anchors) {
    console.log(
      [
        `- id=${a.id}`,
        `name=${a.name}`,
        `systemKey=${a.systemKey ?? 'null'}`,
        `attributionMode=${a.attributionMode}`,
        `enabled=${a.enabled}`,
        `deletedAt=${a.deletedAt?.toISOString() ?? 'null'}`,
        `color=${a.color ?? 'null'}`,
        `sortOrder=${a.sortOrder}`,
        `defaultLiveRoomName=${a.defaultLiveRoomName ?? 'null'}`,
        `timeRuleCount=${a.timeRules.length}`,
        `createdAt=${a.createdAt.toISOString()}`,
      ].join(' | '),
    )
  }

  const liveAnchors = anchors.filter((a) => !a.deletedAt)
  const liveNames = collectNames(liveAnchors.map((a) => a.name))
  console.log(`\n未软删主播数: ${liveAnchors.length}`)
  console.log(`未软删名单: ${[...liveNames].sort((a, b) => a.localeCompare(b, 'zh-CN')).join('、') || '（空）'}`)

  const templates = await prisma.anchorScheduleTemplate.findMany({
    select: { anchorName: true, shopName: true, startTime: true, endTime: true, enabled: true },
  })
  const templateNames = collectNames(templates.map((t) => t.anchorName))

  const daily = await prisma.anchorDailySchedule.findMany({
    select: { anchorName: true },
    distinct: ['anchorName'],
  })
  const dailyNames = collectNames(daily.map((d) => d.anchorName))

  const seedNames = collectNames(NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.map((s) => s.anchorName))

  // 订单归属：尽量从 AnalyzedOrder 缓存/缓存 JSON 与 OfflineDeal 收集
  const offlineAnchors = await prisma.offlineDeal.findMany({
    where: { deletedAt: null },
    select: { anchorName: true },
    distinct: ['anchorName'],
  })
  const offlineNames = collectNames(offlineAnchors.map((o) => o.anchorName))

  // BusinessCache snapshots may hold leaderboard names — best-effort
  const orderAttrNames = new Set<string>()
  try {
    const disposition = await prisma.orderAttributionDisposition.findMany({
      select: { anchorName: true },
      take: 5000,
    })
    for (const d of disposition) {
      const n = normalizeName(d.anchorName)
      if (n) orderAttrNames.add(n)
    }
  } catch {
    /* table may differ */
  }
  try {
    const overrides = await prisma.orderAnchorManualOverride.findMany({
      select: { anchorName: true },
      take: 5000,
    })
    for (const o of overrides) {
      const n = normalizeName(o.anchorName)
      if (n) orderAttrNames.add(n)
    }
  } catch {
    /* optional */
  }

  // FIXED session display names from known constant file if importable
  let fixedSlotNames = new Set<string>()
  try {
    const { FIXED_SESSION_ANCHOR_NAMES } = await import('../../web/src/lib/anchor-session-assign-options')
    fixedSlotNames = collectNames([...FIXED_SESSION_ANCHOR_NAMES])
  } catch {
    fixedSlotNames = collectNames(['子杰', '小红', '飞云', '小艺', '小白'])
  }
  // also Yifan display default
  fixedSlotNames.add('逸凡')

  console.log('\n## 2. 其它来源主播名\n')
  console.log(`排班模板 DB 名 (${templateNames.size}): ${[...templateNames].sort((a,b)=>a.localeCompare(b,'zh-CN')).join('、') || '（空）'}`)
  console.log(`每日排班 distinct 名 (${dailyNames.size}): ${[...dailyNames].sort((a,b)=>a.localeCompare(b,'zh-CN')).join('、') || '（空）'}`)
  console.log(`7.01 代码种子 (${seedNames.size}): ${[...seedNames].join('、')}`)
  console.log(`固定场次槽位 (${fixedSlotNames.size}): ${[...fixedSlotNames].join('、')}`)
  console.log(`线下台账名 (${offlineNames.size}): ${[...offlineNames].sort((a,b)=>a.localeCompare(b,'zh-CN')).join('、') || '（空）'}`)
  console.log(`人工归属/处置名 (${orderAttrNames.size}): ${[...orderAttrNames].sort((a,b)=>a.localeCompare(b,'zh-CN')).join('、') || '（空）'}`)

  const inTemplatesNotAnchor = diff(templateNames, liveNames)
  const inDailyNotAnchor = diff(dailyNames, liveNames)
  const inSeedsNotAnchor = diff(seedNames, liveNames)
  const inSlotsNotAnchor = diff(fixedSlotNames, liveNames)
  const inOrdersNotAnchor = diff(new Set([...orderAttrNames, ...offlineNames]), liveNames)
  const inAnchorNoScheduleOrOrder = [...liveNames].filter(
    (n) =>
      !templateNames.has(n) &&
      !dailyNames.has(n) &&
      !seedNames.has(n) &&
      !orderAttrNames.has(n) &&
      !offlineNames.has(n),
  )

  console.log('\n## 3. 差集\n')
  console.log(`存在于排班模板 DB 但不在 Anchor 主表: ${inTemplatesNotAnchor.join('、') || '无'}`)
  console.log(`存在于每日排班但不在 Anchor 主表: ${inDailyNotAnchor.join('、') || '无'}`)
  console.log(`存在于 7.01 代码种子但不在 Anchor 主表: ${inSeedsNotAnchor.join('、') || '无'}`)
  console.log(`存在于固定槽位但不在 Anchor 主表: ${inSlotsNotAnchor.join('、') || '无'}`)
  console.log(`存在于订单/线下归属但不在 Anchor 主表: ${inOrdersNotAnchor.join('、') || '无'}`)
  console.log(
    `存在于 Anchor 主表但无排班模板/日排班/种子/订单: ${inAnchorNoScheduleOrOrder.join('、') || '无'}`,
  )

  // isManualOnlyAnchor trap
  console.log('\n## 4. isManualOnlyAnchor 误判风险\n')
  for (const a of liveAnchors) {
    const modeManual = a.attributionMode === 'manual'
    const noRules = a.timeRules.filter((r) => r.enabled).length === 0
    const legacyTrap = !modeManual && noRules
    console.log(
      `- ${a.name}: attributionMode=${a.attributionMode}, enabledRules=${a.timeRules.filter((r) => r.enabled).length}, legacy空规则陷阱=${legacyTrap ? '是（会误判为手动）' : '否'}`,
    )
  }

  console.log('\n## 5. 硬编码主播名扫描（分类汇总）\n')
  const hits = scanHardcodedNames()
  const byClass = new Map<HitClass, number>()
  const byName = new Map<string, number>()
  for (const h of hits) {
    byClass.set(h.klass, (byClass.get(h.klass) ?? 0) + 1)
    byName.set(h.name, (byName.get(h.name) ?? 0) + 1)
  }
  console.log('按分类:')
  for (const [k, v] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }
  console.log('按姓名:')
  for (const name of HARDCODED_NAMES) {
    console.log(`  ${name}: ${byName.get(name) ?? 0}`)
  }

  const risky = hits.filter(
    (h) =>
      h.klass === 'UI固定列表/槽位' ||
      h.klass === '颜色映射/硬编码色' ||
      h.klass === '默认配置/种子主数据',
  )
  console.log(`\n高风险命中（UI固定/颜色/默认种子）共 ${risky.length} 条，摘录前 40:\n`)
  for (const h of risky.slice(0, 40)) {
    console.log(`  [${h.klass}] ${h.name} @ ${h.file}:${h.line}`)
    console.log(`    ${h.text}`)
  }

  console.log('\n## 6. 根因初判\n')
  if (liveAnchors.length <= 3) {
    console.log(
      `Anchor 主表未软删仅 ${liveAnchors.length} 人。ensureAnchorsSeeded 空库时只种子「子杰/飞云」，initializeSystemAnchors 再补逸凡 → 典型只有 3 人。`,
    )
    console.log(
      '小红/小艺/小白等更多主播存在于排班模板种子与每日排班字符串中，但从未写入 Anchor 主表，故后台设置页只显示 3 人。',
    )
  } else {
    console.log(`当前主表未软删 ${liveAnchors.length} 人，仍请核对差集是否还有缺失。`)
  }
  console.log(
    'UI 固定槽 FIXED_SESSION_ANCHOR_NAMES、趋势图 #f43f5e / ANCHOR_COLORS[index]、default-anchor-config 仍硬编码姓名/颜色，加剧「展示有人、主数据没有」的分裂。',
  )

  console.log('\n=== diagnose done ===')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
