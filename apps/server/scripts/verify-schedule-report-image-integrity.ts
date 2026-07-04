/**
 * 排班长期有效性 + 运营日报长图 + 图片导出链路验收（只读）
 *
 * npm run verify:schedule-report-image-integrity
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { NEW_SCHEDULE_TEMPLATE_SEEDS_20260701 } from '../src/services/anchor-schedule-template.service'
import { buildDailyOperationsReport } from '../src/services/daily-operations-report.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'

config({ path: path.resolve(__dirname, '../.env') })

const SCHEDULE_DATES = [
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
  '2026-08-01',
  '2026-10-01',
  '2027-01-01',
] as const

const TEMPLATE_ONLY_DATES = ['2026-07-03', '2026-07-05', '2026-08-01', '2026-10-01', '2027-01-01'] as const

const REPORT_DATES = ['2026-07-03', '2026-07-02'] as const

const FORBIDDEN_UI = ['支付金额减退款', '成交减退款', '大额售后', '无大额售后', '实时接口数据']

const failures: string[] = []
const warnings: string[] = []

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function fail(msg: string): void {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`⚠ ${msg}`)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function readWeb(relPath: string): string {
  const filePath = path.resolve(__dirname, '../../web/src', relPath)
  if (!fs.existsSync(filePath)) {
    fail(`找不到 ${relPath}`)
    return ''
  }
  return fs.readFileSync(filePath, 'utf-8')
}

function rowMatchesSeed(
  row: { anchorName: string; shopName: string; startTime: string; endTime: string },
  seed: (typeof NEW_SCHEDULE_TEMPLATE_SEEDS_20260701)[number],
): boolean {
  return (
    row.anchorName === seed.anchorName &&
    row.shopName === seed.shopName &&
    row.startTime === seed.startTime &&
    row.endTime === seed.endTime
  )
}

async function auditSchedules(): Promise<void> {
  section('未来排班长期有效性')
  let table0704Manual = 0
  let table0705Rows = 0

  for (const dateKey of SCHEDULE_DATES) {
    const table = await getEffectiveScheduleTableForDate(dateKey)
    const { manualCount, generatedCount, virtualCount } = table.sourceSummary
    console.log(
      `  ${dateKey}: 生效 ${table.rows.length} 行 · manual ${manualCount} · generated ${generatedCount} · virtual ${virtualCount}`,
    )
    for (const row of table.rows) {
      console.log(
        `    ${row.anchorName} | ${row.shopName} | ${row.liveRoomName} | ${row.startTime}~${row.endTime} | ${row.source}`,
      )
    }

    if (table.rows.length === 0) {
      fail(`${dateKey} 生效排班为空`)
      continue
    }

    const anchorNames = table.rows.map((r) => r.anchorName.trim())
    const dupAnchors = anchorNames.filter((name, idx) => anchorNames.indexOf(name) !== idx)
    if (dupAnchors.length > 0) {
      fail(`${dateKey} 同主播重复排班: ${[...new Set(dupAnchors)].join('、')}`)
    }

    const overlapWarnings = table.warnings.filter((w) => {
      if (w.includes('模板与当天排班冲突') || w.includes('已跳过')) return false
      return (
        w.includes('重叠') ||
        w.includes('已经有一条排班') ||
        (w.includes('生效排班') && w.includes('请检查'))
      )
    })
    if (overlapWarnings.length > 0) {
      fail(`${dateKey} 排班冲突: ${overlapWarnings.join('；')}`)
    } else {
      ok(`${dateKey} 无同主播重复 / 同店重叠冲突`)
    }

    if ((TEMPLATE_ONLY_DATES as readonly string[]).includes(dateKey)) {
      if (table.rows.length !== 5) {
        fail(`${dateKey} 默认日期应有 5 条排班，实际 ${table.rows.length}`)
      } else {
        ok(`${dateKey} 默认日期 5 条排班`)
      }
      for (const seed of NEW_SCHEDULE_TEMPLATE_SEEDS_20260701) {
        const hit = table.rows.find((row) => rowMatchesSeed(row, seed))
        if (!hit) {
          fail(`${dateKey} 缺少默认排班 ${seed.anchorName} ${seed.startTime}~${seed.endTime} ${seed.shopName}`)
        }
      }
      if (table.rows.every((row) =>
        NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.some((seed) => rowMatchesSeed(row, seed)),
      )) {
        ok(`${dateKey} 默认模板 5 条与 2026-07-01 起配置一致`)
      }
    }

    if (dateKey === '2026-07-04') {
      table0704Manual = manualCount
      if (manualCount === 0 && table.rows.length !== 5) {
        warn('2026-07-04 无人工排班且行数不是 5，请确认是否为预期人工覆盖日')
      } else if (manualCount > 0) {
        ok(`2026-07-04 含 ${manualCount} 条人工排班（仅影响当日）`)
      }
    }
    if (dateKey === '2026-07-05') {
      table0705Rows = table.rows.length
    }
  }

  if (table0704Manual > 0 && table0705Rows === 5) {
    ok('人工排班仅影响指定日期：2026-07-05 已恢复默认 5 条')
  } else if (table0704Manual > 0) {
    warn(`2026-07-04 有人工排班，但 2026-07-05 行数=${table0705Rows}`)
  }
}

async function auditDailyReports(): Promise<void> {
  section('运营日报数据')
  await bootstrapQualityBadCaseCache()

  for (const dateKey of REPORT_DATES) {
    try {
      const report = await buildDailyOperationsReport({
        preset: 'custom',
        startDate: dateKey,
        endDate: dateKey,
        role: 'super_admin',
        username: 'verify-script',
      })
      const s = report.summary
      if (s.validAmountYuan == null || s.soldOrderCount == null) {
        fail(`${dateKey} summary 缺少核心字段`)
      } else {
        ok(`${dateKey} summary 核心字段齐全`)
      }
      if (!report.anchors?.length) {
        warn(`${dateKey} anchors 为空（可能当日无数据）`)
      } else {
        ok(`${dateKey} anchors ${report.anchors.length} 行`)
        for (const row of report.anchors) {
          if (!row.anchorName) fail(`${dateKey} 主播行缺少 anchorName`)
          if (row.validAmountYuan == null) fail(`${dateKey} ${row.anchorName} 缺少 validAmountYuan`)
          if (row.soldOrderCount == null) fail(`${dateKey} ${row.anchorName} 缺少 soldOrderCount`)
          const hasLiveText =
            (row.liveTimeRange && row.liveTimeRange !== '—') ||
            (row.livePeriodText && row.livePeriodText !== '—')
          if (!hasLiveText && row.validAmountYuan === 0 && row.soldOrderCount === 0) {
            warn(`${dateKey} ${row.anchorName} 无直播时间且无成交（请确认是否未开播）`)
          }
        }
      }
      if (!report.rankings?.products?.hot) {
        fail(`${dateKey} rankings.products.hot 缺失`)
      } else {
        ok(`${dateKey} 热卖商品榜存在 (${report.rankings.products.hot.items.length} 条)`)
      }
      if (!report.rankings?.products?.highReturn) {
        fail(`${dateKey} rankings.products.highReturn 缺失`)
      } else {
        ok(`${dateKey} 高退货商品榜存在 (${report.rankings.products.highReturn.items.length} 条)`)
      }
      if (!report.businessInsights?.items?.length) {
        warn(`${dateKey} businessInsights 为空`)
      } else {
        ok(`${dateKey} businessInsights ${report.businessInsights.items.length} 条`)
      }
      console.log(
        `  reportDataQuality.warnings: ${report.reportDataQuality?.warnings?.length ?? 0}`,
      )
      if (report.reportDataQuality?.warnings?.length) {
        for (const w of report.reportDataQuality.warnings.slice(0, 3)) {
          console.log(`    - ${w}`)
        }
      }
    } catch (err) {
      fail(`${dateKey} 运营日报构建失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function auditImageSheetStatic(): void {
  section('长图静态检查 OperationsReportImageSheet')
  const content = readWeb('components/operations/OperationsReportImageSheet.tsx')
  if (!content) return

  const required = [
    '全店有效成交',
    '有效成交订单',
    '全店无效/刷单',
    '退货单率',
    '每小时成交',
    '主播表现',
    '热卖商品',
    '高退货商品',
    '经营建议',
    '有部分数据需人工核对',
    '有效成交 = 已完成/已签收',
    '每小时成交 = 全店有效成交',
    '有直播，无成交',
  ]
  for (const phrase of required) {
    if (!content.includes(phrase)) {
      fail(`OperationsReportImageSheet 缺少「${phrase}」`)
    } else {
      ok(`含「${phrase}」`)
    }
  }
  for (const phrase of FORBIDDEN_UI) {
    if (content.includes(phrase)) fail(`OperationsReportImageSheet 含禁用文案「${phrase}」`)
  }
}

function auditExportStatic(): void {
  section('图片导出静态检查 OperationsDailyReport')
  const content = readWeb('pages/operations/OperationsDailyReport.tsx')
  if (!content) return

  if (!content.includes('toPng')) fail('OperationsDailyReport 未使用 toPng')
  else ok('使用 toPng 导出')
  if (!/pixelRatio:\s*2/.test(content)) fail('pixelRatio 未 >= 2')
  else ok('pixelRatio >= 2')
  if (!content.includes("backgroundColor: '#ffffff'")) fail('backgroundColor 不是白色')
  else ok('backgroundColor 白色')
  if (!content.includes('previewUrl')) fail('缺少预览 previewUrl')
  else ok('有预览')
  if (!content.includes('exportError')) fail('缺少 exportError 状态')
  else ok('有 exportError 状态')
  if (!content.includes('{exportError')) fail('exportError 未渲染到页面')
  else ok('exportError 已展示')
  if (!/disabled=\{exporting/.test(content)) fail('exporting 时按钮未 disabled')
  else ok('exporting 时按钮禁用')
  if (!/refreshing/.test(content)) fail('refreshing 时未处理导出')
  else ok('refreshing 时禁用或提示')
  if (!content.includes('下载长图')) fail('缺少下载长图按钮')
  else ok('有下载长图按钮')
  if (content.includes('uploadDailyReportImage') || content.includes('上传图片')) {
    warn('OperationsDailyReport 似乎含上传图片入口，请确认是否与「仅导出长图」一致')
  } else {
    ok('当前页面无上传图片功能（仅导出长图+预览+下载）')
  }
  for (const phrase of FORBIDDEN_UI) {
    if (content.includes(phrase)) fail(`OperationsDailyReport 含禁用文案「${phrase}」`)
  }
}

function auditTrendCompareStatic(): void {
  section('曲线图静态检查')
  const compare = readWeb('components/board/AnchorTrendCompareChart.tsx')
  const panel = readWeb('components/board/AnchorLeaderboardPanel.tsx')
  if (!compare || !panel) return

  if (/MAX_ANCHORS\s*=\s*4/.test(compare)) fail('仍存在 MAX_ANCHORS=4')
  else ok('已取消 MAX_ANCHORS=4')
  if (/最多同时对比\s*4|支付金额最高的\s*4\s*个|前\s*4\s*个主播/.test(compare + panel)) {
    fail('仍含「最多 4 个主播」文案')
  } else {
    ok('无「最多 4 个主播」误导文案')
  }
  if (compare.includes('全部主播') || panel.includes('全部主播')) {
    fail('仍写「全部主播」')
  } else {
    ok('不写「全部主播」')
  }
  if (!/默认展示全部有走势的主播/.test(compare + panel)) {
    fail('缺少「默认展示全部有走势的主播」')
  } else {
    ok('文案：默认展示全部有走势的主播')
  }
  if (!compare.includes('anchorRowGmv')) fail('未按 anchorRowGmv 排序')
  else ok('按支付金额排序')
}

async function auditDefaultTrendAnchors(): Promise<void> {
  section('2026-07-03 默认曲线主播')
  await bootstrapQualityBadCaseCache()
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: '2026-07-03',
    endDate: '2026-07-03',
  })
  const leaderboard = (local.anchorLeaderboard ?? []) as Record<string, unknown>[]
  const paidOnDay = Number(local.anchorPerformanceSummary?.orderCount ?? local.overview?.orderCount ?? 0)

  const defaultCompare = leaderboard
    .filter((row) => {
      const name = String(row.anchorName ?? '').trim()
      if (!name || name === '未归属') return false
      const trend = row.trend as { points?: unknown[] } | undefined
      return Boolean(trend?.points?.length)
    })
    .sort((a, b) => Number(b.totalGmv ?? b.gmv ?? 0) - Number(a.totalGmv ?? a.gmv ?? 0))
    .map((row) => String(row.anchorName).trim())

  console.log(`  默认曲线: ${defaultCompare.join('、') || '—'}`)

  if (paidOnDay === 0) {
    warn('本地 DB 无 2026-07-03 支付数据，跳过 5 主播固定验收')
    return
  }

  for (const name of ['子杰', '飞云', '小艺', '小红', '小白'] as const) {
    if (!defaultCompare.includes(name)) {
      fail(`默认曲线应包含 ${name}`)
    } else {
      ok(`默认曲线包含 ${name}`)
    }
  }
  if (defaultCompare.includes('未归属')) fail('默认曲线包含未归属')
  else ok('默认曲线已排除未归属')
}

async function main(): Promise<void> {
  console.log('[verify:schedule-report-image-integrity] 只读体检，不改数据库')

  const orderTotal = await prisma.xhsRawOrder.count()
  const liveTotal = await prisma.xhsRawLiveSession.count()
  const credTotal = await prisma.platformCredential.count()
  const userTotal = await prisma.user.count()
  section('基础数据')
  console.log(`XhsRawOrder: ${orderTotal}`)
  console.log(`XhsRawLiveSession: ${liveTotal}`)
  console.log(`PlatformCredential: ${credTotal}`)
  console.log(`User: ${userTotal}`)

  auditTrendCompareStatic()
  auditImageSheetStatic()
  auditExportStatic()
  await auditSchedules()
  await auditDailyReports()
  await auditDefaultTrendAnchors()

  section('汇总')
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:schedule-report-image-integrity FAIL')
    process.exit(1)
  }
  console.log('\nverify:schedule-report-image-integrity OK')
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
