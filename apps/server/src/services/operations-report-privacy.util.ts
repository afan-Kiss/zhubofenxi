import type { DailyReportRawOrderRow } from './daily-report-raw-chatgpt.service'

function maskName(name: string): string {
  const t = name.trim()
  if (!t) return ''
  if (t.length === 1) return '*'
  if (t.length === 2) return `${t[0]}*`
  return `${t[0]}${'*'.repeat(Math.max(1, t.length - 2))}${t[t.length - 1]}`
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return phone ? '****' : ''
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

function maskAddress(address: string): string {
  const t = address.trim()
  if (!t) return ''
  return t.replace(/\d+号.*$/, '').replace(/\d+$/, '').trim() || t.slice(0, 8)
}

export function sanitizeDailyReportRawOrderRow(row: DailyReportRawOrderRow): DailyReportRawOrderRow {
  return {
    ...row,
    receiverName: maskName(row.receiverName),
    receiverPhone: maskPhone(row.receiverPhone),
    receiverAddress: maskAddress(row.receiverAddress),
    buyerNickname: maskName(row.buyerNickname),
    buyerDisplayName: maskName(row.buyerDisplayName),
    platformRawJson: '',
  }
}

export function shouldIncludeRawPlatformJson(params: {
  role?: string
  confirmRaw?: boolean
}): boolean {
  return params.role === 'super_admin' && params.confirmRaw === true
}
