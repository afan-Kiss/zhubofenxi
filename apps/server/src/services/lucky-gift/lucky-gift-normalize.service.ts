import { evaluateLuckyGiftAddress } from './lucky-gift-address.util'
import { asIdString, extractRawIdStrings } from './lucky-gift-json.util'
import type { NormalizedLuckyDraw, NormalizedLuckyWinner } from './lucky-gift.types'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function msToNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function unwrapLuckyGiftData(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload)
  if (!root) return null
  const data = asRecord(root.data) ?? root
  return data
}

/** 从中奖人详情 / 物流详情响应中抽取快递公司与单号 */
export function extractLuckyGiftLogistics(payload: unknown): {
  officialCourier: string | null
  officialTrackingNo: string | null
  officialShipped: boolean
} {
  const data = unwrapLuckyGiftData(payload)
  const candidates: Array<Record<string, unknown> | null> = [
    asRecord(data?.logistics),
    asRecord(asRecord(data?.boy)?.logistics),
    asRecord(asRecord(data?.target)?.logistics),
  ]
  const boys = asArray(data?.boys)
  if (boys[0]) candidates.push(asRecord(asRecord(boys[0])?.logistics))

  for (const logistics of candidates) {
    if (!logistics) continue
    const officialCourier =
      String(logistics.logisticsCompany ?? logistics.logistics_company ?? '').trim() || null
    const officialTrackingNo =
      String(logistics.logisticsNumbers ?? logistics.logistics_numbers ?? '').trim() || null
    const officialShipped = Boolean(
      officialTrackingNo && officialTrackingNo !== '-1' && officialTrackingNo !== '-',
    )
    if (officialCourier || officialTrackingNo) {
      return { officialCourier, officialTrackingNo, officialShipped }
    }
  }
  return { officialCourier: null, officialTrackingNo: null, officialShipped: false }
}

export function normalizeLuckyDrawListItem(
  row: unknown,
  rawIdHint?: string | null,
): NormalizedLuckyDraw | null {
  const r = asRecord(row)
  if (!r) return null
  const luckyDrawId = asIdString(r.id ?? r.lucky_draw_id ?? r.luckyDrawId, rawIdHint)
  if (!luckyDrawId) return null
  const sender = asRecord(r.sender)
  return {
    luckyDrawId,
    roomId: asIdString(r.room_id ?? r.roomId, null),
    giftName: String(r.gift_name ?? r.giftName ?? '').trim(),
    senderUserId: sender ? String(sender.user_id ?? sender.userId ?? '').trim() || null : null,
    senderNickname: sender
      ? String(sender.nickname ?? '').trim() || null
      : null,
    drawStatus:
      typeof r.status === 'number'
        ? r.status
        : typeof r.status === 'string' && /^\d+$/.test(r.status)
          ? Number(r.status)
          : null,
    winnerCount: Number(r.lucky_count ?? r.luckyCount ?? r.count ?? 0) || 0,
    createTimeMs: msToNumber(r.create_time ?? r.createTime),
    startTimeMs: msToNumber(r.start_time ?? r.startTime),
    raw: r,
  }
}

export function normalizeLuckyDrawListPayload(
  payload: unknown,
  rawText: string,
): { infos: NormalizedLuckyDraw[]; totalCount: number | null; rawIdTexts: string[] } {
  const data = unwrapLuckyGiftData(payload)
  const rawIdTexts = [
    ...extractRawIdStrings(rawText, 'id'),
    ...extractRawIdStrings(rawText, 'lucky_draw_id'),
  ]
  const idQueue = [...rawIdTexts]
  const infosRaw = asArray(data?.infos ?? data?.list ?? data?.records)
  const infos: NormalizedLuckyDraw[] = []
  for (const row of infosRaw) {
    const hint = idQueue.shift() ?? null
    const n = normalizeLuckyDrawListItem(row, hint)
    if (n) infos.push(n)
  }
  const totalRaw = data?.totalCount ?? data?.total_count ?? data?.total
  const totalCount =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw)
      ? totalRaw
      : typeof totalRaw === 'string' && /^\d+$/.test(totalRaw)
        ? Number(totalRaw)
        : null
  return { infos, totalCount, rawIdTexts }
}

export function normalizeLuckyWinnerBoys(
  payload: unknown,
  luckyDrawId: string,
  rawText: string,
): { draw: NormalizedLuckyDraw | null; winners: NormalizedLuckyWinner[] } {
  const data = unwrapLuckyGiftData(payload)
  const info = asRecord(data?.info)
  const idHints = extractRawIdStrings(rawText, 'id')
  const draw = info
    ? normalizeLuckyDrawListItem(info, idHints[0] ?? luckyDrawId)
    : null
  if (draw) {
    draw.luckyDrawId = luckyDrawId
  }

  const boys = asArray(data?.boys)
  const winners: NormalizedLuckyWinner[] = []
  for (const boy of boys) {
    const b = asRecord(boy)
    if (!b) continue
    const user = asRecord(b.user_info ?? b.userInfo) ?? {}
    const winnerUserId = String(user.user_id ?? user.userId ?? '').trim()
    const redId = String(user.red_id ?? user.redId ?? '').trim() || null
    const winnerKey = winnerUserId || redId || `anon:${winners.length}`
    const winnerNickname = String(user.nickname ?? '').trim()
    const avatar = String(user.avatar ?? '').trim() || null

    const addressObj = asRecord(b.address)
    const evaluated = evaluateLuckyGiftAddress({
      hasAddressObject: Boolean(addressObj),
      name: addressObj ? String(addressObj.name ?? '') : '',
      phone: addressObj ? String(addressObj.phone ?? '') : '',
      province: addressObj ? String(addressObj.province ?? '') : '',
      city: addressObj ? String(addressObj.city ?? '') : '',
      district: addressObj ? String(addressObj.district ?? '') : '',
      detail: addressObj ? String(addressObj.detail ?? '') : '',
    })

    const logistics = asRecord(b.logistics)
    const officialCourier = logistics
      ? String(logistics.logisticsCompany ?? logistics.logistics_company ?? '').trim() || null
      : null
    const officialTrackingNo = logistics
      ? String(logistics.logisticsNumbers ?? logistics.logistics_numbers ?? '').trim() || null
      : null
    const officialShipped = Boolean(
      officialTrackingNo && officialTrackingNo !== '-1' && officialTrackingNo !== '-',
    )

    winners.push({
      luckyDrawId,
      winnerUserId,
      winnerKey,
      redId,
      winnerNickname,
      avatar,
      address: evaluated.hasAddress ? evaluated.fields : null,
      hasAddress: evaluated.hasAddress,
      addressComplete: evaluated.addressComplete,
      addressMissing: evaluated.missing,
      fullAddress: evaluated.fullAddress,
      officialCourier,
      officialTrackingNo,
      officialShipped,
      raw: b,
    })
  }

  return { draw, winners }
}
