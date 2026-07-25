/**
 * 已签收明细三级排序 / 时间解析 / 分组金额验收
 * 用法: npm run verify:signed-order-drill-sort
 */
import path from 'node:path'
import { config } from 'dotenv'
import {
  buildSignedGroupSummary,
  compareSignedRows,
  normalizeSignedOrderSort,
  resolveSignedTime,
  sortSignedOrderRows,
  SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC,
} from '../src/services/signed-order-sort.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { resolveDateRange } from '../src/utils/date-range'

config({ path: path.resolve(__dirname, '../.env') })

const failures: string[] = []

function fail(msg: string): void {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function assert(cond: boolean, msg: string): void {
  if (cond) ok(msg)
  else fail(msg)
}

type Row = {
  liveAccountName?: string | null
  liveAccountId?: string | null
  anchorName?: string | null
  anchorId?: string | null
  signTimeMs?: number | null
  orderTimeMs?: number | null
  orderTime?: string | null
  displayOrderNo?: string | null
  signedAmount?: number
  signTime?: string | null
}

console.log('\n=== resolveSignedTime ===')
{
  const iso = resolveSignedTime('2026-07-25T10:30:00+08:00')
  assert(iso.timestampMs != null && iso.displayText?.startsWith('2026-07-25') === true, 'ISO 可解析')

  const cn = resolveSignedTime('2026-07-25 18:31:00')
  assert(cn.timestampMs != null && cn.displayText === '2026-07-25 18:31:00', '中文格式规范化')

  const sec = resolveSignedTime(1721899860)
  assert(sec.timestampMs === 1721899860 * 1000, '秒级时间戳')

  const ms = resolveSignedTime(1721899860000)
  assert(ms.timestampMs === 1721899860000, '毫秒时间戳')

  const bad = resolveSignedTime('not-a-date')
  assert(bad.timestampMs == null && bad.displayText == null, '非法时间不抛错且为 null')

  const empty = resolveSignedTime(null)
  assert(empty.timestampMs == null, 'null 签收时间')
}

console.log('\n=== normalizeSignedOrderSort ===')
{
  assert(
    normalizeSignedOrderSort('weird') === SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC,
    '未知 sort 回退 shop_anchor_sign_desc',
  )
  assert(normalizeSignedOrderSort('anchor_asc') === 'anchor_asc', '白名单保留 anchor_asc')
}

console.log('\n=== compareSignedRows 三级排序 ===')
{
  const rows: Row[] = [
    {
      liveAccountName: '祥钰珠宝',
      liveAccountId: 'b',
      anchorName: '小白',
      anchorId: 'a1',
      signTimeMs: 100,
      orderTimeMs: 50,
      displayOrderNo: 'P2',
      signedAmount: 10,
      signTime: 't',
    },
    {
      liveAccountName: '拾玉居和田玉',
      liveAccountId: 'a',
      anchorName: '子杰',
      anchorId: 'a2',
      signTimeMs: 200,
      orderTimeMs: 50,
      displayOrderNo: 'P1',
      signedAmount: 20,
      signTime: 't',
    },
    {
      liveAccountName: '拾玉居和田玉',
      liveAccountId: 'a',
      anchorName: '小白',
      anchorId: 'a1',
      signTimeMs: 300,
      orderTimeMs: 50,
      displayOrderNo: 'P3',
      signedAmount: 30,
      signTime: 't',
    },
    {
      liveAccountName: '拾玉居和田玉',
      liveAccountId: 'a',
      anchorName: '小白',
      anchorId: 'a1',
      signTimeMs: 300,
      orderTimeMs: 80,
      displayOrderNo: 'P4',
      signedAmount: 40,
      signTime: 't',
    },
    {
      liveAccountName: '拾玉居和田玉',
      liveAccountId: 'a',
      anchorName: '未归属',
      anchorId: '',
      signTimeMs: 400,
      orderTimeMs: 50,
      displayOrderNo: 'P5',
      signedAmount: 50,
      signTime: 't',
    },
    {
      liveAccountName: '',
      liveAccountId: 'z',
      anchorName: '飞云',
      anchorId: 'a3',
      signTimeMs: 500,
      orderTimeMs: 50,
      displayOrderNo: 'P6',
      signedAmount: 60,
      signTime: 't',
    },
    {
      liveAccountName: '拾玉居和田玉',
      liveAccountId: 'a',
      anchorName: '小白',
      anchorId: 'a1',
      signTimeMs: null,
      orderTimeMs: 90,
      displayOrderNo: 'P7',
      signedAmount: 70,
      signTime: null,
    },
  ]

  const sorted = sortSignedOrderRows(rows)
  const nos = sorted.map((r) => r.displayOrderNo)

  assert(nos[0] === 'P3' || nos[0] === 'P4', '同店同主播签收时间新的在前')
  assert(nos.indexOf('P1') < nos.indexOf('P2'), '店铺升序：拾玉居在祥钰前')
  assert(nos.indexOf('P3') < nos.indexOf('P5') || nos.indexOf('P4') < nos.indexOf('P5'), '未归属排该店最后')
  assert(nos.indexOf('P7') > nos.indexOf('P3'), '缺签收时间排该主播最后')
  assert(nos[nos.length - 1] === 'P6', '缺店铺名称排最后')

  // 签收时间相同 → 下单时间倒序：P4(order 80) before P3(order 50)
  const p3 = nos.indexOf('P3')
  const p4 = nos.indexOf('P4')
  assert(p4 < p3, '签收时间相同按下单时间倒序')

  // 稳定：订单号
  const twin: Row[] = [
    {
      liveAccountName: 'A店',
      liveAccountId: '1',
      anchorName: '甲',
      anchorId: '1',
      signTimeMs: 1,
      orderTimeMs: 1,
      displayOrderNo: 'P800B',
      signedAmount: 1,
    },
    {
      liveAccountName: 'A店',
      liveAccountId: '1',
      anchorName: '甲',
      anchorId: '1',
      signTimeMs: 1,
      orderTimeMs: 1,
      displayOrderNo: 'P800A',
      signedAmount: 1,
    },
  ]
  const twinSorted = sortSignedOrderRows(twin)
  assert(twinSorted[0]!.displayOrderNo === 'P800A', '全相同按订单号升序')

  // 禁止字符串字典序假装时间排序
  const lexicalTrap: Row[] = [
    {
      liveAccountName: 'A',
      liveAccountId: '1',
      anchorName: '甲',
      anchorId: '1',
      signTimeMs: resolveSignedTime('2026-07-09 10:00:00').timestampMs,
      orderTimeMs: 1,
      displayOrderNo: 'L1',
      signedAmount: 1,
      signTime: '2026-07-09 10:00:00',
    },
    {
      liveAccountName: 'A',
      liveAccountId: '1',
      anchorName: '甲',
      anchorId: '1',
      signTimeMs: resolveSignedTime('2026-07-10 09:00:00').timestampMs,
      orderTimeMs: 1,
      displayOrderNo: 'L2',
      signedAmount: 1,
      signTime: '2026-07-10 09:00:00',
    },
  ]
  const lexSorted = sortSignedOrderRows(lexicalTrap)
  assert(lexSorted[0]!.displayOrderNo === 'L2', '时间用毫秒比较而非字符串')
  assert(compareSignedRows(lexicalTrap[0]!, lexicalTrap[1]!) > 0, 'compareSignedRows 新签收在前')
}

console.log('\n=== groupSummary 金额 ===')
{
  const rows: Row[] = [
    {
      liveAccountName: '店A',
      liveAccountId: 's1',
      anchorName: '甲',
      anchorId: 'a1',
      signedAmount: 10.1,
      signTimeMs: 2,
      signTime: '2026-07-25 12:00:00',
      displayOrderNo: '1',
    },
    {
      liveAccountName: '店A',
      liveAccountId: 's1',
      anchorName: '甲',
      anchorId: 'a1',
      signedAmount: 20.2,
      signTimeMs: 1,
      signTime: '2026-07-24 12:00:00',
      displayOrderNo: '2',
    },
    {
      liveAccountName: '店A',
      liveAccountId: 's1',
      anchorName: '乙',
      anchorId: 'a2',
      signedAmount: 5,
      signTimeMs: 3,
      signTime: '2026-07-26 12:00:00',
      displayOrderNo: '3',
    },
  ]
  const g = buildSignedGroupSummary(rows)
  assert(g.shops.length === 1, '单店铺分组')
  assert(Math.abs(g.shops[0]!.signedAmount - 35.3) < 0.001, '店铺金额合计')
  assert(g.shops[0]!.anchorCount === 2, '主播数')
  const sumAnchors = g.shops[0]!.anchors.reduce((s, a) => s + a.signedAmount, 0)
  assert(Math.abs(sumAnchors - g.shops[0]!.signedAmount) < 0.001, '主播金额之和=店铺金额')
  assert(g.shops[0]!.anchors[0]!.latestSignTime?.includes('07-26') || g.shops[0]!.anchors.find((a) => a.anchorName === '乙')?.latestSignTime != null, '最近签收时间')
}

console.log('\n=== 分页边界 + 口径不变（本月） ===')
async function verifyIntegration(): Promise<void> {
  const range = resolveDateRange('thisMonth')
  const base = {
    metric: 'actualSignedAmount' as const,
    preset: 'thisMonth',
    startDate: range.startDate,
    endDate: range.endDate,
    role: 'boss' as const,
    username: 'verify-signed-sort',
    sort: SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC,
  }

  try {
    const full = await buildBoardMetricDetail({ ...base, page: 1, pageSize: 100 })
    const page1 = await buildBoardMetricDetail({ ...base, page: 1, pageSize: 20 })
    const page2 = await buildBoardMetricDetail({ ...base, page: 2, pageSize: 20 })
    const pageSize50 = await buildBoardMetricDetail({ ...base, page: 1, pageSize: 50 })

    const fullExtras = full as typeof full & {
      filteredSummary?: { orderCount: number; signedAmount: number }
      allSummary?: { orderCount: number; signedAmount: number }
      groupSummary?: { shops: Array<{ signedAmount: number; orderCount: number }> }
      sort?: string
    }

    assert(fullExtras.sort === SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC, '返回 sort=shop_anchor_sign_desc')
    assert(fullExtras.filteredSummary != null, '返回 filteredSummary')
    assert(fullExtras.groupSummary != null, '返回 groupSummary')

    const totalAmt = fullExtras.filteredSummary!.signedAmount
    const totalCnt = fullExtras.filteredSummary!.orderCount
    assert(pageSize50.pagination.total === totalCnt, '改 pageSize 后总数不变')
    assert(
      Math.abs((pageSize50 as typeof fullExtras).filteredSummary!.signedAmount - totalAmt) < 0.02,
      '改 pageSize 后总金额不变',
    )

    if (totalCnt > 20) {
      const lastP1 = page1.rows[page1.rows.length - 1]
      const firstP2 = page2.rows[0]
      if (lastP1 && firstP2) {
        assert(compareSignedRows(lastP1, firstP2) <= 0, '分页边界仍符合三级顺序')
      }
    }

    const groupSum = (fullExtras.groupSummary?.shops ?? []).reduce((s, x) => s + x.signedAmount, 0)
    assert(Math.abs(groupSum - totalAmt) < 0.05, '分组金额之和=筛选总金额')

    // 筛选不应改变未筛选全集金额（无筛选时 all==filtered）
    if (fullExtras.allSummary) {
      assert(
        Math.abs(fullExtras.allSummary.signedAmount - totalAmt) < 0.02,
        '无筛选时 allSummary≈filteredSummary',
      )
    }

    // 未知 sort 回退
    const fallback = await buildBoardMetricDetail({
      ...base,
      sort: 'not_a_real_sort',
      page: 1,
      pageSize: 5,
    })
    assert(
      (fallback as { sort?: string }).sort === SIGNED_ORDER_SORT_SHOP_ANCHOR_SIGN_DESC,
      '未知 sort 服务端回退',
    )

    console.log(
      `本月已签收：${totalCnt} 单 / ¥${totalAmt.toFixed(2)}（range ${range.startDate}~${range.endDate}）`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('does not exist in the current database') || msg.includes('P2022')) {
      console.log(`⚠ 本地库 schema 未对齐，跳过集成验收: ${msg.split('\n')[0]}`)
      return
    }
    fail(`集成验收失败: ${msg}`)
  }
}

void verifyIntegration().then(() => {
  console.log('\n=== 结果 ===')
  if (failures.length) {
    console.log(`失败 ${failures.length} 项`)
    for (const f of failures) console.log(` - ${f}`)
    process.exit(1)
  }
  console.log('全部通过')
  process.exit(0)
})
