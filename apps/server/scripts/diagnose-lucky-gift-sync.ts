/**
 * 福袋同步只读诊断
 * 用法：
 *   npm run diagnose:lucky-gifts -- --shop=hetianyayu
 *   npm run diagnose:lucky-gifts -- --shop=hetianyayu --dry-run --raw-shape --limit=3
 */
import { GOOD_REVIEW_SHOPS } from '../src/config/good-review-shops.constants'
import { resolveOfficialShopAccountForStatus } from '../src/services/official-shop-account.service'
import { resolveLiveAccountCookie } from '../src/services/qianfan-cookie-resolver.service'
import {
  fetchAllLuckyGiftDraws,
  fetchLuckyGiftHistoryPage,
  fetchLuckyGiftWinners,
  resolveLuckyGiftHostId,
} from '../src/services/lucky-gift/lucky-gift-api.service'
import {
  listLuckyGiftRoomIdsForAccount,
  resolveLuckyGiftHostIdForAccount,
} from '../src/services/lucky-gift/lucky-gift-host-resolver.service'
import { classifyLuckyGiftListPage, parseLuckyGiftListPage } from '../src/services/lucky-gift/lucky-gift-platform-response.util'
import { prisma } from '../src/lib/prisma'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=').trim() : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function redactShape(rawText: string): Record<string, unknown> {
  let payload: unknown
  try {
    payload = JSON.parse(rawText)
  } catch {
    return { parseError: true, rawLen: rawText.length }
  }
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const data1 = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
  const data2 =
    data1.data && typeof data1.data === 'object' ? (data1.data as Record<string, unknown>) : data1
  const infos = (data2.infos ?? data1.infos) as unknown
  const first = Array.isArray(infos) && infos[0] && typeof infos[0] === 'object' ? (infos[0] as Record<string, unknown>) : null
  return {
    topKeys: Object.keys(root),
    dataKeys: Object.keys(data2),
    code: root.code ?? null,
    msg: root.msg ?? null,
    totalCount: data2.totalCount ?? data2.total ?? null,
    infosLen: Array.isArray(infos) ? infos.length : null,
    firstInfoKeys: first ? Object.keys(first) : [],
    firstInfoSample: first
      ? {
          id: String(first.id ?? ''),
          room_id: String(first.room_id ?? first.roomId ?? ''),
          gift_name: String(first.gift_name ?? first.giftName ?? ''),
          lucky_count: first.lucky_count ?? first.luckyCount ?? null,
        }
      : null,
  }
}

async function main(): Promise<void> {
  const shopKey = arg('shop') || 'hetianyayu'
  const limit = arg('limit') ? Number(arg('limit')) : undefined
  const dryRun = hasFlag('dry-run')
  const rawShape = hasFlag('raw-shape')
  const shop = GOOD_REVIEW_SHOPS.find((s) => s.shopKey === shopKey)
  if (!shop) {
    console.error('unknown shop', shopKey)
    process.exit(2)
  }

  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) {
    console.error('no account')
    process.exit(2)
  }
  const cookie = await resolveLiveAccountCookie(account.id, shop.shopName)
  const hostResolved = await resolveLuckyGiftHostIdForAccount(account.id, cookie || '')
  const cookieHostId = cookie ? resolveLuckyGiftHostId(cookie) : null
  const roomIds = await listLuckyGiftRoomIdsForAccount(account.id)

  const out: Record<string, unknown> = {
    shopKey,
    shopName: shop.shopName,
    liveAccountId: account.id,
    hasCookie: Boolean(cookie),
    cookieLen: cookie?.length ?? 0,
    hasA1: cookie ? /(?:^|;\s*)a1=/.test(cookie) : false,
    hostId: hostResolved.hostId,
    hostIdSource: hostResolved.source,
    cookieHostId,
    roomIdCount: roomIds.length,
    roomIdSamples: roomIds.slice(0, 5),
    dryRun,
  }

  if (roomIds[0]) {
    const page = await fetchLuckyGiftHistoryPage({
      shop,
      hostId: hostResolved.hostId,
      roomId: roomIds[0],
      page: 1,
    })
    const classified = classifyLuckyGiftListPage(page.parsed, page.rawText)
    out.historyProbe = {
      roomId: roomIds[0],
      requestUrl: `lucky_draw_history/get?hostId=${hostResolved.hostId}&room_id=${roomIds[0]}&page=1&pageSize=50`,
      classified,
      parsedCount: page.infos.length,
      parsedTotal: page.totalCount,
      firstDrawId: page.infos[0]?.luckyDrawId ?? null,
      rawShape: rawShape ? redactShape(page.rawText) : undefined,
    }
  }

  if (!dryRun && limit != null) {
    const synced = await import('../src/services/lucky-gift/lucky-gift-sync.service').then((m) =>
      m.syncLuckyGiftShop(shop, 'diagnose', { maxDraws: limit }),
    )
    out.syncSample = synced
  } else {
    const fetched = await fetchAllLuckyGiftDraws({
      shop,
      trigger: 'diagnose',
      maxDraws: limit,
      limitRooms: limit != null ? 3 : undefined,
    })
    out.fetch = {
      syncStatus: fetched.syncStatus,
      syncStatusError: fetched.syncStatusError,
      fetchedCount: fetched.fetchedCount,
      roomsScanned: fetched.roomsScanned,
      roomsWithData: fetched.roomsWithData,
      drawIds: fetched.draws.slice(0, 5).map((d) => d.luckyDrawId),
      roomStats: fetched.roomStats.filter((r) => r.fetchedCount > 0).slice(0, 5),
    }
    if (fetched.draws[0]) {
      const detail = await fetchLuckyGiftWinners({
        shop,
        luckyDrawId: fetched.draws[0].luckyDrawId,
        hostId: fetched.hostId,
        trigger: 'diagnose',
      })
      out.detailProbe = {
        luckyDrawId: fetched.draws[0].luckyDrawId,
        winnerCount: detail.winners.length,
        withAddress: detail.winners.filter((w) => w.hasAddress).length,
        addressComplete: detail.winners.filter((w) => w.addressComplete).length,
      }
    }
  }

  const dbDrawCount = await prisma.xhsLuckyDraw.count({ where: { liveAccountId: account.id } })
  const dbWinnerCount = await prisma.xhsLuckyWinner.count({ where: { liveAccountId: account.id } })
  out.db = { drawCount: dbDrawCount, winnerCount: dbWinnerCount }

  console.log(JSON.stringify(out, null, 2))
  await prisma.$disconnect()
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
