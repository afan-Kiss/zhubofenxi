/**
 * 本地预览：渲染新版日报长图并截图（不部署）。
 * npx tsx apps/server/scripts/preview-daily-report-image-layout.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const OUT_DIR = path.resolve(__dirname, '../../../tmp/daily-report-image-preview')
const OUT_HTML = path.join(OUT_DIR, 'preview.html')
const OUT_PNG = path.join(OUT_DIR, 'daily-report-image-preview.png')

const FIXTURE = {
  dateLabel: '2026-07-17 星期五',
  title: '主播业绩日报',
  startDate: '2026-07-17',
  endDate: '2026-07-17',
  summary: {
    totalShippedAmountYuan: 42860,
    totalSoldOrderCount: 38,
    totalInvalidOrderCount: 2,
    totalLiveDurationMinutes: 980,
    overallHourlyAmountYuan: 2620,
    liveRoomNewFollowers: [],
    totalNewFollowerCount: 0,
    onlineGmvYuan: 51200,
    offlineGmvYuan: 0,
    offlineDealCount: 0,
    totalGmvYuan: 51200,
  },
  anchors: [],
  // 故意不含「祥钰珠宝」：当日无排班/直播/业绩 → 时间轴与卡片都不出现该店
  imageSessions: [
    {
      id: '1',
      shopName: '和田雅玉',
      anchorName: '小白',
      startTime: '2026-07-17T09:30:00+08:00',
      endTime: '2026-07-17T14:00:00+08:00',
      liveTimeRange: '09:30-14:00',
      liveDurationText: '4小时30分',
      liveDurationMinutes: 270,
      shipmentAmountYuan: 12860,
      gmvYuan: 15200,
      orderCount: 12,
      refundAmountYuan: 320,
      coverClickRate: 0.082,
      stay60sUserCount: 186,
      avgStayDurationSeconds: 96,
      status: 'qualified',
      color: '#f43f5e',
    },
    {
      id: '2',
      shopName: '和田雅玉',
      anchorName: '小小',
      startTime: '2026-07-17T18:30:00+08:00',
      endTime: '2026-07-17T23:00:00+08:00',
      liveTimeRange: '18:30-23:00',
      liveDurationText: '4小时30分',
      liveDurationMinutes: 270,
      shipmentAmountYuan: 9800,
      gmvYuan: 11200,
      orderCount: 9,
      refundAmountYuan: 0,
      coverClickRate: 0.061,
      stay60sUserCount: 142,
      avgStayDurationSeconds: 88,
      status: 'warning',
      color: '#3b82f6',
    },
    {
      id: '3',
      shopName: '拾玉居和田玉',
      anchorName: '小艺',
      startTime: '2026-07-17T09:30:00+08:00',
      endTime: '2026-07-17T14:00:00+08:00',
      liveTimeRange: '09:30-14:00',
      liveDurationText: '4小时30分',
      liveDurationMinutes: 270,
      shipmentAmountYuan: 11200,
      gmvYuan: 13800,
      orderCount: 10,
      refundAmountYuan: 180,
      coverClickRate: 0.041,
      stay60sUserCount: 98,
      avgStayDurationSeconds: 72,
      status: 'unqualified',
      color: '#22c55e',
    },
    {
      id: '4',
      shopName: '拾玉居和田玉',
      anchorName: '子杰',
      startTime: '2026-07-17T15:00:00+08:00',
      endTime: '2026-07-17T18:00:00+08:00',
      liveTimeRange: '15:00-18:00',
      liveDurationText: '3小时',
      liveDurationMinutes: 180,
      shipmentAmountYuan: 5200,
      gmvYuan: 6400,
      orderCount: 5,
      refundAmountYuan: null,
      coverClickRate: null,
      stay60sUserCount: null,
      avgStayDurationSeconds: 110,
      status: 'missing',
      color: '#f59e0b',
    },
    {
      id: '5',
      shopName: '飞云珠宝',
      anchorName: '飞云',
      startTime: '2026-07-17T18:30:00+08:00',
      endTime: '2026-07-17T23:40:00+08:00',
      liveTimeRange: '18:30-23:40',
      liveDurationText: '5小时10分',
      liveDurationMinutes: 310,
      shipmentAmountYuan: 3800,
      gmvYuan: 4600,
      orderCount: 2,
      refundAmountYuan: 50,
      coverClickRate: 0.075,
      stay60sUserCount: 64,
      avgStayDurationSeconds: 84,
      status: 'qualified',
      color: '#a855f7',
    },
  ],
}

function buildStandaloneHtml(): string {
  // Minimal standalone mock of the layout (mirrors DailyReportImageSheet structure)
  // so we can screenshot without booting the full Vite app.
  const sessions = FIXTURE.imageSessions
  const shops = [...new Set(sessions.map((s) => s.shopName))]
  const viewStart = 8 * 60
  const viewEnd = 24 * 60
  const span = viewEnd - viewStart

  function toMin(range: string, which: 0 | 1): number {
    const p = range.split('-')[which]!
    const [h, m] = p.split(':').map(Number)
    return h! * 60 + m!
  }

  const ticks = Array.from({ length: 17 }, (_, i) => 8 * 60 + i * 60)
  const shopRows = shops
    .map((shop) => {
      const bars = sessions
        .filter((s) => s.shopName === shop)
        .map((s) => {
          const start = toMin(s.liveTimeRange, 0)
          const end = toMin(s.liveTimeRange, 1)
          const left = ((start - viewStart) / span) * 100
          const width = ((Math.max(end - start, 20) ) / span) * 100
          return `<div class="bar" style="left:${left}%;width:${width}%;border-color:${s.color};background:${s.color}22">
            <div class="ship">发货 ¥${s.shipmentAmountYuan.toLocaleString('zh-CN')}</div>
            <div class="name" style="color:${s.color}">${s.anchorName}</div>
            <div class="time">${s.liveTimeRange}</div>
          </div>`
        })
        .join('')
      return `<div class="row"><div class="label">${shop}</div><div class="track">${bars}</div></div>`
    })
    .join('')

  const statusLabel: Record<string, string> = {
    qualified: '合格',
    warning: '待关注',
    unqualified: '不合格',
    missing: '数据缺失',
  }
  const statusClass: Record<string, string> = {
    qualified: 'ok',
    warning: 'warn',
    unqualified: 'bad',
    missing: 'miss',
  }

  const cards = sessions
    .map((s) => {
      const ctr =
        s.coverClickRate == null ? '数据缺失' : `${(s.coverClickRate * 100).toFixed(1)}%`
      const stay60 = s.stay60sUserCount == null ? '数据缺失' : `${s.stay60sUserCount}人`
      const refund = s.refundAmountYuan == null ? '—' : `¥${s.refundAmountYuan.toLocaleString('zh-CN')}`
      return `<div class="card">
        <div class="card-h">
          <div>
            <div class="shop">${s.shopName}</div>
            <div class="meta">主播：${s.anchorName}</div>
            <div class="meta">直播时段：${s.liveTimeRange}</div>
          </div>
          <span class="badge ${statusClass[s.status]}">${statusLabel[s.status]}</span>
        </div>
        <div class="grid">
          <div><div class="k">GMV</div><div class="v">¥${s.gmvYuan.toLocaleString('zh-CN')}</div></div>
          <div><div class="k">发货金额</div><div class="v">¥${s.shipmentAmountYuan.toLocaleString('zh-CN')}</div></div>
          <div><div class="k">订单数</div><div class="v">${s.orderCount} 单</div></div>
          <div><div class="k">退款金额</div><div class="v">${refund}</div></div>
          <div><div class="k">封面点击率</div><div class="v">${ctr}</div></div>
          <div><div class="k">60s停留人数</div><div class="v">${stay60}</div></div>
          <div><div class="k">人均停留</div><div class="v">${s.avgStayDurationSeconds ?? '—'}秒</div></div>
          <div><div class="k">直播时长</div><div class="v">${s.liveDurationText}</div></div>
        </div>
      </div>`
    })
    .join('')

  const axis = ticks
    .map((m) => {
      const left = ((m - viewStart) / span) * 100
      const label = m >= 24 * 60 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:00`
      return `<div class="tick" style="left:${left}%"><span>${label}</span></div>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>日报长图预览</title>
<style>
  body{margin:0;background:#e2e8f0;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
  #sheet{width:980px;margin:24px auto;background:#f8fafc;padding:20px;box-sizing:border-box}
  .header{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .eyebrow{font-size:11px;color:#94a3b8;font-weight:600}
  h1{margin:4px 0 0;font-size:22px;color:#0f172a}
  .sum{margin-top:12px;display:flex;gap:20px;font-size:12px;color:#475569}
  .sum strong{color:#0f172a}
  .tl{margin-top:16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .tl-h{padding:10px 16px;border-bottom:1px solid #f1f5f9}
  .tl-h h3{margin:0;font-size:14px}
  .tl-h p{margin:2px 0 0;font-size:11px;color:#94a3b8}
  .axis{position:relative;height:28px;margin-left:112px;border-bottom:1px solid #f1f5f9}
  .tick{position:absolute;top:0;bottom:0;border-left:1px solid #f1f5f9}
  .tick span{position:absolute;left:2px;top:4px;font-size:10px;color:#94a3b8}
  .row{display:flex;border-top:1px solid #f1f5f9;height:56px}
  .label{width:112px;flex-shrink:0;display:flex;align-items:center;padding:0 8px;font-size:12px;font-weight:600;color:#334155;background:#f8fafc;border-right:1px solid #f1f5f9}
  .track{position:relative;flex:1}
  .bar{position:absolute;top:12px;bottom:8px;border:1px solid;border-radius:6px;padding:2px 6px;overflow:visible;box-shadow:0 1px 2px rgba(0,0,0,.05)}
  .ship{position:absolute;top:-18px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:1px 6px;font-size:10px;color:#334155;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  .name{font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .time{font-size:10px;color:#64748b}
  .cards-h{margin:16px 0 8px;display:flex;justify-content:space-between;align-items:baseline}
  .cards-h h3{margin:0;font-size:14px}
  .cards-h span{font-size:11px;color:#94a3b8}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04);min-height:168px}
  .card-h{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #f1f5f9}
  .shop{font-size:13px;font-weight:700;color:#1e293b}
  .meta{font-size:11px;color:#64748b;margin-top:2px}
  .badge{align-self:flex-start;font-size:10px;font-weight:600;border-radius:999px;padding:2px 8px;border:1px solid}
  .badge.ok{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
  .badge.warn{background:#fffbeb;color:#b45309;border-color:#fde68a}
  .badge.bad{background:#fff1f2;color:#be123c;border-color:#fecdd3}
  .badge.miss{background:#f1f5f9;color:#64748b;border-color:#e2e8f0}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px}
  .k{font-size:10px;color:#94a3b8}
  .v{font-size:13px;font-weight:700;color:#0f172a;margin-top:2px}
  .note{margin-top:12px;font-size:11px;color:#64748b;text-align:center}
</style>
</head>
<body>
<div id="sheet">
  <div class="header">
    <div class="eyebrow">主播业绩日报</div>
    <h1>2026-07-17 星期五</h1>
    <div class="sum">
      <span>真实发货 <strong>¥42,860</strong></span>
      <span>真实卖出 <strong>38 单</strong></span>
      <span>直播场次 <strong>5</strong></span>
    </div>
  </div>
  <div class="tl">
    <div class="tl-h"><h3>直播时间轴总览</h3><p>按店铺分行，仅展示当日有实际直播场次的店铺（本例无祥钰珠宝）</p></div>
    <div class="axis">${axis}</div>
    ${shopRows}
  </div>
  <div class="cards-h"><h3>场次数据卡片</h3><span>共 5 场 · 两列布局</span></div>
  <div class="cards">${cards}</div>
  <p class="note">本地布局预览 · 未部署服务器 · 祥钰珠宝因无场次数据未显示</p>
</div>
</body>
</html>`
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_HTML, buildStandaloneHtml(), 'utf-8')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 1600 },
      deviceScaleFactor: 2,
    })
    await page.goto(`file://${OUT_HTML.replace(/\\/g, '/')}`, { waitUntil: 'load' })
    const sheet = page.locator('#sheet')
    await sheet.screenshot({ path: OUT_PNG, type: 'png' })
    console.log(JSON.stringify({ ok: true, html: OUT_HTML, png: OUT_PNG }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
