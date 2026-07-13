import { prisma } from '../../lib/prisma'
import {
  createQianfanArkServiceOpenTicket,
  QianfanOrderOpenTicketError,
} from '../qianfan-order-open-ticket.service'
import { buildLuckyGiftArkServiceUrl, LUCKY_GIFT_REFERER } from './lucky-gift.types'

export { QianfanOrderOpenTicketError }

export async function createLuckyGiftQianfanOpenTicket(winnerId: string): Promise<{
  ticket: string
  expiresInSeconds: number
  openUrl: string
  hasTicket: boolean
  fallbackToBaseUrl: boolean
  luckyDrawId: string | null
}> {
  const id = String(winnerId || '').trim()
  if (!id) {
    throw new QianfanOrderOpenTicketError('缺少中奖记录 ID')
  }

  const winner = await prisma.xhsLuckyWinner.findUnique({
    where: { id },
    select: { id: true, liveAccountId: true, luckyDrawId: true },
  })
  if (!winner) {
    throw new QianfanOrderOpenTicketError('中奖记录不存在')
  }
  if (!winner.liveAccountId) {
    throw new QianfanOrderOpenTicketError('缺少直播号信息')
  }

  const serviceUrl = buildLuckyGiftArkServiceUrl(winner.luckyDrawId)
  const ticket = await createQianfanArkServiceOpenTicket({
    serviceUrl,
    liveAccountId: winner.liveAccountId,
    referer: LUCKY_GIFT_REFERER,
  })

  return {
    ...ticket,
    luckyDrawId: winner.luckyDrawId ?? null,
  }
}
