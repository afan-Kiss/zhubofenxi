/**
 * 福袋卡片：主播归属、截止期限、顺丰费用缓存 — 静态验收
 */
import {
  computeAddressDeadlineAt,
  computeShipDeadlineAt,
  computeDeadlineStatus,
  formatAddressExpiryLabel,
  formatDeadlineLabel,
} from '../src/services/lucky-gift/lucky-gift-deadline.util'
import { extractAddressSubmittedAt } from '../src/services/lucky-gift/lucky-gift-address-time.util'
import {
  giftNameImpliesCollectFreight,
  resolveFreightLabelForDisplay,
  resolveFreightForCopy,
} from '../src/services/lucky-gift/lucky-gift-freight.util'
import { shouldQuerySfFee, isSfTrackingNo } from '../src/services/lucky-gift/lucky-gift-sf-fee.service'
import { querySfWaybillFee } from '../src/services/sf-waybill-fee.service'
import {
  matchScheduleAnchor,
  matchSessionByTime,
  sanitizeLuckyGiftAnchorName,
} from '../src/services/lucky-gift/lucky-gift-anchor-attribution.service'
import { buildLuckyGiftArkServiceUrl } from '../src/services/lucky-gift/lucky-gift.types'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function main() {
  const issues: string[] = []

  const win = new Date('2026-07-08T16:49:00+08:00')
  const addrDeadline = computeAddressDeadlineAt(win)
  assert(
    addrDeadline.toISOString().startsWith('2026-07-14'),
    `address deadline should be Jul 14, got ${addrDeadline.toISOString()}`,
    issues,
  )
  const addrLabel = formatAddressExpiryLabel(addrDeadline)
  assert(addrLabel.includes('领奖失效'), 'address expiry label', issues)
  assert(!addrLabel.includes('填写地址截止'), 'no legacy address deadline prefix', issues)
  assert(!addrLabel.includes('15'), 'no-address label must not mention 15-day ship rule', issues)

  const addrSubmit = new Date('2026-07-10T10:00:00+08:00')
  const shipDeadline = computeShipDeadlineAt(addrSubmit)
  assert(
    shipDeadline.toISOString().startsWith('2026-07-24'),
    `ship deadline day15 should be Jul 24, got ${shipDeadline.toISOString()}`,
    issues,
  )
  const shipLabel = formatDeadlineLabel(shipDeadline, '最晚发货', 'normal')
  assert(shipLabel.includes('最晚发货'), 'ship label', issues)
  assert(!shipLabel.includes('填写地址'), 'pending ship label must not mention address rule', issues)

  const platformRaw = JSON.stringify({
    address: { update_time: 1783500552000 },
  })
  const extracted = extractAddressSubmittedAt(platformRaw, null)
  assert(extracted.source === 'platform', 'platform address time source', issues)
  assert(extracted.at != null, 'platform address time parsed', issues)

  const estimate = extractAddressSubmittedAt(null, new Date('2026-07-11T08:00:00+08:00'))
  assert(estimate.source === 'first_seen_estimate', 'first_seen_estimate source', issues)

  assert(giftNameImpliesCollectFreight('时尚手镯（运费自理）'), 'freight in gift name', issues)
  assert(resolveFreightLabelForDisplay('时尚手镯（运费自理）') === null, 'no duplicate freight tag', issues)
  assert(resolveFreightForCopy('时尚手镯（运费自理）') === '运费自理', 'copy freight from name', issues)

  assert(!shouldQuerySfFee({ trackingNo: 'YT123', shipmentStatus: 'shipped', sfFeeStatus: null, sfFeeQueriedAt: null, sfFeeTrackingNo: null }), 'non-SF no query', issues)
  assert(!shouldQuerySfFee({ trackingNo: 'SF1234567890123', shipmentStatus: 'no_address', sfFeeStatus: null, sfFeeQueriedAt: null, sfFeeTrackingNo: null }), 'no_address no query', issues)
  assert(shouldQuerySfFee({ trackingNo: 'SF1234567890123', shipmentStatus: 'pending', sfFeeStatus: null, sfFeeQueriedAt: null, sfFeeTrackingNo: null }), 'pending SF tracking may query fee', issues)
  assert(isSfTrackingNo('SF1234567890123'), 'SF tracking regex', issues)

  const schedRows = [
    {
      anchorName: '小红',
      shopName: '和田玉韵',
      liveRoomName: '和田玉韵',
      startAt: new Date('2026-07-08T19:00:00+08:00'),
      endAt: new Date('2026-07-08T23:00:00+08:00'),
    },
  ]
  assert(
    matchScheduleAnchor('和田玉韵', new Date('2026-07-08T20:00:00+08:00'), schedRows) === '小红',
    'schedule anchor match',
    issues,
  )
  const sessions = [
    {
      liveAccountId: 'acc-a',
      liveId: 'room-1',
      anchorName: '小艺',
      startTime: new Date('2026-07-08T18:00:00+08:00'),
      endTime: new Date('2026-07-08T22:00:00+08:00'),
    },
    {
      liveAccountId: 'acc-a',
      liveId: 'room-2',
      anchorName: '飞云',
      startTime: new Date('2026-07-08T22:30:00+08:00'),
      endTime: new Date('2026-07-09T01:00:00+08:00'),
    },
  ]
  assert(
    matchSessionByTime('acc-a', new Date('2026-07-08T21:00:00+08:00'), sessions) === '小艺',
    'session_time fallback match',
    issues,
  )
  assert(
    matchSessionByTime('acc-a', new Date('2026-07-08T23:00:00+08:00'), sessions) === '飞云',
    'session_time picks correct overlapping session',
    issues,
  )

  assert(
    sanitizeLuckyGiftAnchorName('和田雅玉', '和田雅玉') == null,
    'shop name must not pass as anchor',
    issues,
  )
  assert(
    sanitizeLuckyGiftAnchorName('小红', '和田雅玉') === '小红',
    'real anchor name kept',
    issues,
  )

  assert(
    buildLuckyGiftArkServiceUrl('138008565063504647').includes('lucky_draw_id=138008565063504647'),
    'lucky gift ark url includes draw id',
    issues,
  )

  const cachedRecent = shouldQuerySfFee({
    trackingNo: 'SF1234567890123',
    shipmentStatus: 'shipped',
    sfFeeStatus: 'available',
    sfFeeQueriedAt: new Date(),
    sfFeeTrackingNo: 'SF1234567890123',
  })
  assert(!cachedRecent, 'available cache within 24h skips query', issues)

  const badWaybill = await querySfWaybillFee('ABC', {
    partnerID: 'test',
    checkWord: 'test',
    monthlyCard: '123',
  })
  assert(!badWaybill.ok, 'invalid waybill rejected', issues)

  const pageSrc = await import('fs/promises').then((fs) =>
    fs.readFile('apps/web/src/pages/board/LuckyGiftsPage.tsx', 'utf8'),
  )
  for (const banned of [
    '福袋编号',
    '直播间编号',
    '状态来源',
    'rawAddress',
    '展开更多信息',
    '中奖第',
    '距离7天还剩',
    '平台要求填写地址后15日内发货',
    '小红书号',
    '填写地址截止',
  ]) {
    assert(!pageSrc.includes(banned), `page must not contain banned text: ${banned}`, issues)
  }
  assert(pageSrc.includes('formatAnchorDisplayName'), 'anchor display helper', issues)
  assert(pageSrc.includes('anchorLabel(item)'), 'anchor label on card', issues)
  assert(pageSrc.includes('物流详情'), 'shipped logistics detail entry', issues)

  assert(pageSrc.includes('跳转千帆'), 'qianfan jump button on card', issues)
  assert(pageSrc.includes('openQianfanLuckyGift'), 'qianfan open helper', issues)
  assert(!pageSrc.includes('onShip'), 'row must not use ship modal trigger', issues)

  assert(pageSrc.includes('福袋 ID'), 'lucky draw id visible on card', issues)
  assert(pageSrc.includes('luckyDrawId'), 'lucky draw id field on card', issues)
  assert(pageSrc.includes('liveAccountName'), 'shop name field on card', issues)
  assert(pageSrc.includes('店铺'), 'shop label on card', issues)

  if (issues.length) {
    console.error('[verify:lucky-gift-anchor-fee] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:lucky-gift-anchor-fee] OK')
}

void main()
