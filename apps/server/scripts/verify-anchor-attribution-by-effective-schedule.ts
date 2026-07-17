/**
 * 确定性归属验收：独立临时 SQLite，不依赖业务库真实订单
 * 业务日相对上海「昨天/今天」，避免看板 custom 把结束日截到今天后丢 fixture。
 * npm run verify:anchor-attribution-by-effective-schedule
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  shanghaiTodayDateKey,
  shanghaiYesterdayDateKey,
} from '../src/utils/anchor-effective-date.util'
import { addDaysShanghai } from '../src/utils/business-timezone'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'

const serverRoot = path.resolve(__dirname, '..')
const require = createRequire(__filename)

const SHOP = '__TEST_SHOP_ATTR__'
const FORMAL = '__TEST_OFFBOARD_ANCHOR__'
const TEMP_A = '__TEST_TEMP_ANCHOR__'

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, args, { cwd: serverRoot, env, encoding: 'utf8', shell: true })
  if (r.status !== 0) {
    console.error(r.stdout)
    console.error(r.stderr)
    throw new Error(`${cmd} failed`)
  }
}

function shanghaiPayIso(dateKey: string, hm: string): string {
  return `${dateKey} ${hm}:00`
}

/** 必须能通过 normalizeXhsOrderPackage；下单时间=支付时间（归属按 createTime） */
function buildOrderRaw(params: {
  packageId: string
  payDate: string
  payHm: string
  amountYuan: number
}): Record<string, unknown> {
  const pay = shanghaiPayIso(params.payDate, params.payHm)
  return {
    packageId: params.packageId,
    orderId: params.packageId,
    paidAt: pay,
    payTime: pay,
    paymentTime: pay,
    createTime: pay,
    orderedAt: pay,
    sellerName: SHOP,
    shopName: SHOP,
    liveAccountName: SHOP,
    nickName: SHOP,
    actualPaid: params.amountYuan,
    totalGoodsPayAmount: params.amountYuan,
    statusDesc: '已完成',
    skus: [
      {
        skuName: '测试SKU',
        skuId: 'sku-test',
        quantity: 1,
        price: params.amountYuan,
      },
    ],
  }
}

async function main() {
  const DAY_LAST = shanghaiYesterdayDateKey()
  const DAY_NEXT = shanghaiTodayDateKey()
  const DAY_EMPTY = addDaysShanghai(DAY_LAST, -5)
  const DAY_FROM = addDaysShanghai(DAY_LAST, -16)
  const TEMP_KEY_LAST = `temp:${DAY_LAST}:test-anchor-a`
  const TEMP_KEY_NEXT = `temp:${DAY_NEXT}:test-anchor-a`

  console.log('verify:anchor-attribution-by-effective-schedule（临时库 fixture）')
  console.log(`  DAY_LAST=${DAY_LAST} DAY_NEXT=${DAY_NEXT} DAY_EMPTY=${DAY_EMPTY}\n`)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhubo-attr-'))
  const dbPath = path.join(dir, 'attr.db')
  const dbUrl = `file:${dbPath.replace(/\\/g, '/')}`
  process.env.DATABASE_URL = dbUrl
  const env = { ...process.env, DATABASE_URL: dbUrl }

  try {
    run('npx', ['prisma', 'migrate', 'deploy'], env)
    run('npx', ['prisma', 'generate'], env)

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

    const { offboardAnchor, canScheduleFormalAnchorOnDate } = await import(
      '../src/services/anchor-offboard.service'
    )
    const { saveDailySchedules } = await import('../src/services/anchor-daily-schedule.service')
    const { resolveAnchorWithScheduleOverlay, clearScheduleAttributionCache } = await import(
      '../src/services/anchor-schedule-attribution.service'
    )
    const { invalidateBusinessBoardCache, getOrBuildBusinessBoardCache } = await import(
      '../src/services/business-cache.service'
    )
    const { executeBoardAnchorsQuery } = await import('../src/services/board-local-query.service')
    const { refreshAnchorConfigCache } = await import('../src/services/anchor.service')
    const { buildRawAnalyzeBundleAll } = await import(
      '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
    )
    const { prepareAnalysisArtifactsFromRaw } = await import('../src/services/business-analysis.service')
    const { attachRawByMatchToViews } = await import('../src/services/low-price-brush-order.service')

    const liveAccountId = 'test-live-attr-1'
    const formalSlot = buildScheduleBounds(DAY_LAST, '00:00', '14:00')
    const tempSlot1 = buildScheduleBounds(DAY_LAST, '14:00', '18:30')
    const tempSlot2 = buildScheduleBounds(DAY_LAST, '18:30', '24:00')
    const nextTempSlot = buildScheduleBounds(DAY_NEXT, '09:00', '17:00')

    try {
      const formal = await prisma.anchor.create({
        data: {
          name: FORMAL,
          color: '#aa0000',
          enabled: true,
          attributionMode: 'schedule',
          effectiveFrom: DAY_FROM,
          effectiveTo: null,
          sortOrder: 1,
        },
      })

      await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: DAY_LAST,
          anchorId: formal.id,
          anchorName: FORMAL,
          shopName: SHOP,
          liveRoomName: SHOP,
          startAt: formalSlot.startAt,
          endAt: formalSlot.endAt,
          source: 'manual',
          enabled: true,
          confirmed: true,
          isTemporaryAnchor: false,
        },
      })

      await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: DAY_LAST,
          anchorId: null,
          anchorName: TEMP_A,
          shopName: SHOP,
          liveRoomName: SHOP,
          startAt: tempSlot1.startAt,
          endAt: tempSlot1.endAt,
          source: 'manual',
          enabled: true,
          confirmed: true,
          isTemporaryAnchor: true,
          temporaryAnchorKey: TEMP_KEY_LAST,
          anchorColorSnapshot: '#00aa00',
        },
      })

      await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: DAY_LAST,
          anchorId: null,
          anchorName: TEMP_A,
          shopName: SHOP,
          liveRoomName: SHOP,
          startAt: tempSlot2.startAt,
          endAt: tempSlot2.endAt,
          source: 'manual',
          enabled: true,
          confirmed: true,
          isTemporaryAnchor: true,
          temporaryAnchorKey: TEMP_KEY_LAST,
          anchorColorSnapshot: '#00aa00',
        },
      })

      const orders = [
        { packageId: 'P_TEST_FORMAL_LAST', payDate: DAY_LAST, payHm: '10:00', amountYuan: 100 },
        { packageId: 'P_TEST_TEMP_14', payDate: DAY_LAST, payHm: '15:00', amountYuan: 200 },
        { packageId: 'P_TEST_TEMP_19', payDate: DAY_LAST, payHm: '19:00', amountYuan: 50 },
        { packageId: 'P_TEST_NEXT_NO_TEMP', payDate: DAY_NEXT, payHm: '10:00', amountYuan: 80 },
        { packageId: 'P_TEST_NEXT_TEMP_KEY2', payDate: DAY_NEXT, payHm: '12:00', amountYuan: 30 },
      ]
      for (const o of orders) {
        const raw = buildOrderRaw(o)
        await prisma.xhsRawOrder.create({
          data: {
            packageId: o.packageId,
            orderId: o.packageId,
            liveAccountId,
            liveAccountName: SHOP,
            orderTime: new Date(`${o.payDate}T${o.payHm}:00+08:00`),
            paymentTime: new Date(`${o.payDate}T${o.payHm}:00+08:00`),
            displayOrderNo: o.packageId,
            gmvCent: Math.round(o.amountYuan * 100),
            rawJson: raw as object,
          },
        })
      }

      await refreshAnchorConfigCache()
      clearScheduleAttributionCache()
      invalidateBusinessBoardCache()

      await offboardAnchor({
        id: formal.id,
        effectiveTo: DAY_LAST,
        reason: 'fixture offboard',
      })
      await refreshAnchorConfigCache()
      clearScheduleAttributionCache()
      invalidateBusinessBoardCache()

      const afterOffboard = await prisma.anchor.findUniqueOrThrow({ where: { id: formal.id } })
      assert.equal(afterOffboard.enabled, false)
      assert.equal(afterOffboard.effectiveTo, DAY_LAST)
      assert.equal(canScheduleFormalAnchorOnDate(afterOffboard, DAY_LAST).ok, true)
      assert.equal(canScheduleFormalAnchorOnDate(afterOffboard, DAY_NEXT).ok, false)

      let rejected = false
      try {
        await saveDailySchedules({
          date: DAY_NEXT,
          schedules: [
            {
              anchorId: formal.id,
              anchorName: FORMAL,
              shopName: SHOP,
              liveRoomName: SHOP,
              startTime: '09:00',
              endTime: '12:00',
              enabled: true,
            },
          ],
          createdBy: 'verify',
        })
      } catch {
        rejected = true
      }
      assert.equal(rejected, true, '离职次日带 anchorId 应拒绝')

      rejected = false
      try {
        await saveDailySchedules({
          date: DAY_NEXT,
          schedules: [
            {
              anchorId: null,
              anchorName: FORMAL,
              shopName: SHOP,
              liveRoomName: SHOP,
              startTime: '09:00',
              endTime: '12:00',
              enabled: true,
            },
          ],
          createdBy: 'verify',
        })
      } catch {
        rejected = true
      }
      assert.equal(rejected, true, '离职次日仅提交姓名应拒绝')
      console.log('  ✓ 正式主播最后工作日有效；次日排班与姓名绕过均拒绝')

      await getOrBuildBusinessBoardCache({
        preset: 'custom',
        startDate: DAY_LAST,
        endDate: DAY_LAST,
        interactive: true,
      })

      const bundle = await buildRawAnalyzeBundleAll()
      assert.ok(bundle)
      const artifacts = prepareAnalysisArtifactsFromRaw(bundle!)
      const rawByMatch = new Map(
        (artifacts.dedupe.uniqueOrders ?? []).map((o: { matchOrderId: string; raw: unknown }) => [
          o.matchOrderId,
          o.raw,
        ]),
      )
      const views = attachRawByMatchToViews(artifacts.views, rawByMatch)

      const findView = (pkg: string) =>
        views.find(
          (v: { packageId?: string; orderId?: string; matchOrderId?: string }) =>
            v.packageId === pkg || v.orderId === pkg || v.matchOrderId === pkg,
        )

      const formalView = findView('P_TEST_FORMAL_LAST')
      assert.ok(formalView, '正式主播订单视图存在')
      const formalResolved = await resolveAnchorWithScheduleOverlay(formalView!)
      assert.equal(formalResolved.anchorName, FORMAL)
      assert.equal(formalResolved.anchorId, formal.id)
      assert.notEqual(formalResolved.anchorName, '未归属')
      console.log('  ✓ 最后工作日订单归属正式主播（enabled=false 仍有效）')

      const tempView = findView('P_TEST_TEMP_14')
      assert.ok(tempView)
      const tempResolved = await resolveAnchorWithScheduleOverlay(tempView!)
      assert.equal(tempResolved.anchorName, TEMP_A)
      assert.equal(tempResolved.anchorId, TEMP_KEY_LAST)
      assert.notEqual(tempResolved.anchorName, '未归属')
      console.log('  ✓ 临时主播当天订单按时段归属')

      const tempView2 = findView('P_TEST_TEMP_19')
      assert.ok(tempView2)
      const tempResolved2 = await resolveAnchorWithScheduleOverlay(tempView2!)
      assert.equal(tempResolved2.anchorName, TEMP_A)
      assert.equal(tempResolved2.anchorId, TEMP_KEY_LAST)

      const tempInAnchor = await prisma.anchor.findFirst({ where: { name: TEMP_A } })
      assert.equal(tempInAnchor, null)
      console.log('  ✓ 临时主播未写入全局 Anchor')

      {
        const bundle2 = await buildRawAnalyzeBundleAll()
        const artifacts2 = prepareAnalysisArtifactsFromRaw(bundle2!)
        const views2 = attachRawByMatchToViews(
          artifacts2.views,
          new Map(
            (artifacts2.dedupe.uniqueOrders ?? []).map((o: { matchOrderId: string; raw: unknown }) => [
              o.matchOrderId,
              o.raw,
            ]),
          ),
        )
        const vNext = views2.find(
          (v: { packageId?: string }) => v.packageId === 'P_TEST_NEXT_NO_TEMP',
        )
        assert.ok(vNext, '次日无排班订单视图存在')
        const rNext = await resolveAnchorWithScheduleOverlay(vNext!)
        assert.notEqual(rNext.anchorName, TEMP_A, '不得沿用前一天临时主播')
        assert.notEqual(rNext.anchorName, FORMAL, '不得归属已离职正式主播')
        assert.equal(rNext.anchorName, '未归属')
        console.log('  ✓ 次日无临时排班订单进入未归属，不沿用临时/离职正式')
      }

      invalidateBusinessBoardCache()
      const anchorsResult = await executeBoardAnchorsQuery({
        preset: 'custom',
        startDate: DAY_LAST,
        endDate: DAY_LAST,
        role: 'super_admin',
        username: 'verify-attr',
      })
      assert.ok(anchorsResult.anchorPerformanceSummary, 'anchorPerformanceSummary 存在')
      const board = anchorsResult.anchorLeaderboard as Array<{
        anchorName: string
        anchorId?: string
        gmv?: number
        totalGmv?: number
        orderCount?: number
      }>
      const formalCard = board.find((r) => r.anchorName === FORMAL)
      const tempCards = board.filter((r) => r.anchorName === TEMP_A)
      assert.ok(formalCard, '正式主播业绩卡存在')
      assert.equal(formalCard!.anchorId, formal.id)
      assert.equal(tempCards.length, 1, '同 temporaryAnchorKey 合并为一张卡')
      assert.equal(tempCards[0]!.anchorId, TEMP_KEY_LAST)
      const tempGmv = Number(tempCards[0]!.gmv ?? tempCards[0]!.totalGmv ?? 0)
      assert.ok(tempGmv >= 250, `临时主播 GMV 应合计>=250，实际 ${tempGmv}`)
      console.log('  ✓ local-query：临时多班次合并、正式卡存在、GMV 合计')

      invalidateBusinessBoardCache()
      const emptyDay = await executeBoardAnchorsQuery({
        preset: 'custom',
        startDate: DAY_EMPTY,
        endDate: DAY_EMPTY,
        role: 'super_admin',
        username: 'verify-attr',
      })
      const tempOnEmpty = (emptyDay.anchorLeaderboard as Array<{ anchorName: string }>).filter(
        (r) => r.anchorName === TEMP_A,
      )
      assert.equal(tempOnEmpty.length, 0, '无排班日不出现临时空卡')
      console.log('  ✓ 非临时排班日不生成临时空卡')

      await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: DAY_NEXT,
          anchorId: null,
          anchorName: TEMP_A,
          shopName: SHOP,
          liveRoomName: SHOP,
          startAt: nextTempSlot.startAt,
          endAt: nextTempSlot.endAt,
          source: 'manual',
          enabled: true,
          confirmed: true,
          isTemporaryAnchor: true,
          temporaryAnchorKey: TEMP_KEY_NEXT,
          anchorColorSnapshot: '#0000aa',
        },
      })
      clearScheduleAttributionCache()
      invalidateBusinessBoardCache()
      {
        const bundle3 = await buildRawAnalyzeBundleAll()
        const artifacts3 = prepareAnalysisArtifactsFromRaw(bundle3!)
        const views3 = attachRawByMatchToViews(
          artifacts3.views,
          new Map(
            (artifacts3.dedupe.uniqueOrders ?? []).map((o: { matchOrderId: string; raw: unknown }) => [
              o.matchOrderId,
              o.raw,
            ]),
          ),
        )
        const vKey2 = views3.find(
          (v: { packageId?: string }) => v.packageId === 'P_TEST_NEXT_TEMP_KEY2',
        )
        assert.ok(vKey2)
        const rKey2 = await resolveAnchorWithScheduleOverlay(vKey2!)
        assert.equal(rKey2.anchorName, TEMP_A)
        assert.equal(rKey2.anchorId, TEMP_KEY_NEXT, '次日应使用独立 temporaryAnchorKey')

        const multi = await executeBoardAnchorsQuery({
          preset: 'custom',
          startDate: DAY_LAST,
          endDate: DAY_NEXT,
          role: 'super_admin',
          username: 'verify-attr',
        })
        const tempMulti = (
          multi.anchorLeaderboard as Array<{ anchorName: string; anchorId?: string }>
        ).filter((r) => r.anchorName === TEMP_A)
        const ids = new Set(tempMulti.map((r) => r.anchorId).filter(Boolean))
        assert.ok(
          ids.has(TEMP_KEY_LAST) && ids.has(TEMP_KEY_NEXT),
          `多日同名临时主播应按 key 区分，实际 ids=${[...ids].join(',')}`,
        )
        console.log('  ✓ 不同日期同名临时主播使用各自 temporaryAnchorKey')
      }

      console.log('\nPASS')
    } finally {
      await prisma.$disconnect()
    }
  } finally {
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
