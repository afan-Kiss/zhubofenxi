import type { BossFundSnapshot, BossShopScoreSnapshot } from '@prisma/client'

export interface BossAdviceItem {
  level: 'warning' | 'danger' | 'info'
  text: string
}

export function buildBossShopAdvice(params: {
  fund: BossFundSnapshot | null
  score: BossShopScoreSnapshot | null
  previousScore: BossShopScoreSnapshot | null
}): BossAdviceItem[] {
  const out: BossAdviceItem[] = []
  const prev = params.previousScore
  const cur = params.score
  if (cur && prev) {
    if ((cur.qualityScore ?? 0) < (prev.qualityScore ?? cur.qualityScore ?? 0)) {
      out.push({
        level: 'danger',
        text: '品质分下降，优先检查直播中颜色、材质、证书、天然包容和尺寸是否说清楚，并查看最近新增的品质负向反馈。',
      })
    }
    if ((cur.logisticsScore ?? 0) < (prev.logisticsScore ?? cur.logisticsScore ?? 0)) {
      out.push({
        level: 'danger',
        text: '物流分下降，检查付款后超过24小时仍未揽收的订单，以及异常中转、错发和漏发情况。',
      })
    }
    if ((cur.serviceScore ?? 0) < (prev.serviceScore ?? cur.serviceScore ?? 0)) {
      out.push({
        level: 'danger',
        text: '服务分下降，检查客服三分钟回复率、售后响应速度、满意度和平台介入订单。',
      })
    }
  }
  const fund = params.fund
  if (fund?.afterSaleFrozenAmountCent != null && fund.afterSaleFrozenAmountCent >= 500_000) {
    out.push({
      level: 'warning',
      text: '售后冻结金额较高，先处理金额最大的售后单，避免可提现金额长期被占用。',
    })
  }
  if (fund?.canWithdraw === false) {
    out.push({
      level: 'danger',
      text: fund.cannotWithdrawReason
        ? `当前不可提现：${fund.cannotWithdrawReason}。请先按平台提示处理账户或售后问题。`
        : '当前不可提现，请先到小红书商家后台查看具体限制原因。',
    })
  }
  if (fund?.debtAmountCent != null && fund.debtAmountCent > 0) {
    out.push({
      level: 'danger',
      text: '账户存在欠款，请尽快补缴，避免影响提现和店铺经营。',
    })
  }
  if (out.length === 0) {
    out.push({ level: 'info', text: '当前未发现明显风险项，继续按排班开播并关注售后和物流时效。' })
  }
  return out
}
