const QUALITY_KEYWORDS = [
  '质量问题',
  '品质问题',
  '商品质量',
  '瑕疵',
  '裂',
  '裂纹',
  '破损',
  '断裂',
  '磕碰',
  '掉色',
  '色差严重',
  '描述不符',
  '做工问题',
  '材质问题',
  '假货',
  '非天然',
  '有问题',
  '损坏',
]

const NON_QUALITY_KEYWORDS = ['不喜欢', '拍错', '多拍', '不想要', '七天无理由', '无理由']

export function collectReasonText(row: Record<string, unknown>, headers: string[]): string {
  const parts: string[] = []
  for (const h of headers) {
    const v = String(row[h] ?? '').trim()
    if (v) parts.push(v)
  }
  return parts.join('；')
}

export function findReasonHeaders(allHeaders: string[]): string[] {
  const keys = ['售后原因', '退款原因', '退货原因', '买家申请原因', '问题描述', '申请原因']
  return allHeaders.filter((h) => keys.some((k) => h.includes(k)))
}

export function isQualityReturnReason(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (NON_QUALITY_KEYWORDS.some((k) => value.includes(k))) return false
  return QUALITY_KEYWORDS.some((k) => value.includes(k))
}

export function summarizeReason(text: string, maxLen = 24): string {
  const t = text.trim()
  if (!t) return '—'
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t
}
