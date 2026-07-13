/** 福袋地址/发货截止时间（上海时区日历日） */

export type DeadlineStatus = 'normal' | 'due_soon' | 'overdue'

const SH_TZ = 'Asia/Shanghai'

function shanghaiDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: SH_TZ })
}

function endOfShanghaiDay(dateKey: string): Date {
  return new Date(`${dateKey}T23:59:59.999+08:00`)
}

function addCalendarDays(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T12:00:00+08:00`)
  base.setDate(base.getDate() + days)
  return shanghaiDateKey(base)
}

/** 中奖后第7天 23:59:59（中奖当天为第1天） */
export function computeAddressDeadlineAt(winTime: Date): Date {
  const winKey = shanghaiDateKey(winTime)
  const deadlineKey = addCalendarDays(winKey, 6)
  return endOfShanghaiDay(deadlineKey)
}

/** 地址填写后第15天 23:59:59（填写当天为第1天） */
export function computeShipDeadlineAt(addressSubmittedAt: Date): Date {
  const addrKey = shanghaiDateKey(addressSubmittedAt)
  const deadlineKey = addCalendarDays(addrKey, 14)
  return endOfShanghaiDay(deadlineKey)
}

export function computeDeadlineStatus(deadlineAt: Date, now = new Date()): DeadlineStatus {
  if (now.getTime() > deadlineAt.getTime()) return 'overdue'
  const msLeft = deadlineAt.getTime() - now.getTime()
  if (msLeft <= 2 * 86_400_000) return 'due_soon'
  return 'normal'
}

export function formatDeadlineLabel(
  deadlineAt: Date,
  prefix: string,
  status: DeadlineStatus,
): string {
  if (status === 'overdue') {
    if (prefix.includes('填写地址') || prefix.includes('领奖')) return '已超过领奖失效时间'
    return '已超过发货截止时间'
  }
  const d = deadlineAt
  const pad = (n: number) => String(n).padStart(2, '0')
  const label = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${prefix}：${label}`
}

/** 未填地址：用相对时间表达「多久后领奖失效」 */
export function formatAddressExpiryLabel(deadlineAt: Date, now = new Date()): string {
  const status = computeDeadlineStatus(deadlineAt, now)
  if (status === 'overdue') return '已超过领奖失效时间'

  const msLeft = Math.max(0, deadlineAt.getTime() - now.getTime())
  const totalHours = Math.max(1, Math.ceil(msLeft / 3_600_000))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  if (days >= 1) {
    return hours > 0 ? `${days}天${hours}小时后领奖失效` : `${days}天后领奖失效`
  }
  return `${totalHours}小时后领奖失效`
}
