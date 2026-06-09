export type XhsMoneySource = 'order' | 'live' | 'settlement'

export interface ParseXhsMoneyInput {
  value?: unknown
  displayValue?: unknown
  source: XhsMoneySource
  fieldCode?: string
}

export interface ParseXhsMoneyResult {
  cent: number
  sourceUsed: 'displayValue' | 'value' | 'none'
  unit: 'yuan' | 'cent' | 'unknown'
  warning: string | null
}

function parseDisplayToCent(display: unknown): number | null {
  if (display == null || display === '') return null
  const s = String(display).replace(/[^\d.-]/g, '')
  if (!s) return null
  const yuan = Number(s)
  if (!Number.isFinite(yuan)) return null
  return Math.round(yuan * 100)
}

function parseValueToCent(value: unknown, source: XhsMoneySource): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  if (source === 'settlement') {
    if (Math.abs(n) >= 10000 && Number.isInteger(n)) return Math.round(n)
    return Math.round(n * 100)
  }
  if (Math.abs(n) < 10000 && String(value).includes('.')) return Math.round(n * 100)
  if (Math.abs(n) >= 10000) return Math.round(n)
  return Math.round(n * 100)
}

export function parseXhsMoneyField(input: ParseXhsMoneyInput): ParseXhsMoneyResult {
  const displayCent = parseDisplayToCent(input.displayValue)
  const valueCent = parseValueToCent(input.value, input.source)

  if (displayCent != null && valueCent != null) {
    const ratio =
      displayCent > 0 && valueCent > 0
        ? Math.max(displayCent, valueCent) / Math.min(displayCent, valueCent)
        : 1
    if (ratio >= 50) {
      return {
        cent: displayCent,
        sourceUsed: 'displayValue',
        unit: 'yuan',
        warning: `字段 ${input.fieldCode ?? ''} value 与 displayValue 差约 100 倍，已采用 displayValue`,
      }
    }
  }

  if (displayCent != null) {
    return { cent: displayCent, sourceUsed: 'displayValue', unit: 'yuan', warning: null }
  }
  if (valueCent != null) {
    return {
      cent: valueCent,
      sourceUsed: 'value',
      unit: input.source === 'settlement' ? 'cent' : 'yuan',
      warning: null,
    }
  }
  return { cent: 0, sourceUsed: 'none', unit: 'unknown', warning: '无法解析金额' }
}
