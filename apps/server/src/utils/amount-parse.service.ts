export type AmountParseStrategy =
  | 'displayValue'
  | 'value_as_cent'
  | 'value_as_yuan'
  | 'displayValue_100x_fix'
  | 'heuristic_cent'
  | 'heuristic_yuan'
  | 'empty'

export interface AmountParseResult {
  cent: number
  strategy: AmountParseStrategy
  warnings: string[]
  rawValue: unknown
  displayValue: unknown
  parsedYuan: number
}

function parseDisplayYuanToCent(display: unknown): number | null {
  if (display == null || display === '') return null
  const text = String(display).replace(/[￥¥,\s]/g, '')
  const num = Number(text)
  if (!Number.isFinite(num)) return null
  return Math.round(num * 100)
}

function parseNumeric(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[￥¥,\s]/g, ''))
  return Number.isFinite(num) ? num : null
}

function ratioNear(a: number, b: number, factor: number): boolean {
  if (a === 0 || b === 0) return false
  const r = a / b
  return r > factor * 0.98 && r < factor * 1.02
}

/** 智能解析金额到分：优先 displayValue，自动识别 value 是分还是元 */
export function parseMoneyToCent(
  raw: unknown,
  displayValue?: unknown,
  fieldName?: string,
): AmountParseResult {
  const warnings: string[] = []
  const num = parseNumeric(raw)
  const fromDisplay = displayValue != null ? parseDisplayYuanToCent(displayValue) : null

  if (fromDisplay != null) {
    if (num != null && num !== 0) {
      const asYuanCent = Math.round(num * 100)
      const asCent = Math.round(num)
      if (ratioNear(asCent, fromDisplay, 100) && !ratioNear(asYuanCent, fromDisplay, 1)) {
        warnings.push(
          `${fieldName ?? '金额'} value 与 displayValue 相差约 100 倍，已采用 displayValue`,
        )
        return {
          cent: fromDisplay,
          strategy: 'displayValue_100x_fix',
          warnings,
          rawValue: raw,
          displayValue,
          parsedYuan: fromDisplay / 100,
        }
      }
      if (ratioNear(asYuanCent, fromDisplay, 100) && !ratioNear(asCent, fromDisplay, 1)) {
        warnings.push(
          `${fieldName ?? '金额'} value 疑似按元放大 100 倍，已采用 displayValue`,
        )
        return {
          cent: fromDisplay,
          strategy: 'displayValue_100x_fix',
          warnings,
          rawValue: raw,
          displayValue,
          parsedYuan: fromDisplay / 100,
        }
      }
    }
    return {
      cent: fromDisplay,
      strategy: 'displayValue',
      warnings,
      rawValue: raw,
      displayValue,
      parsedYuan: fromDisplay / 100,
    }
  }

  if (num == null) {
    return {
      cent: 0,
      strategy: 'empty',
      warnings,
      rawValue: raw,
      displayValue,
      parsedYuan: 0,
    }
  }

  const str = String(raw)
  const hasDecimal = str.includes('.')
  const abs = Math.abs(num)

  if (Number.isInteger(num) && !hasDecimal && abs >= 1000) {
    const asCent = Math.round(num)
    const asYuanCent = Math.round(num * 100)
    if (asYuanCent > 10_000_000 * 100) {
      return {
        cent: asCent,
        strategy: 'heuristic_cent',
        warnings: [`${fieldName ?? '金额'} 大整数按分解析`],
        rawValue: raw,
        displayValue,
        parsedYuan: asCent / 100,
      }
    }
    if (abs >= 10_000 && abs % 100 === 0) {
      return {
        cent: asCent,
        strategy: 'heuristic_cent',
        warnings: [],
        rawValue: raw,
        displayValue,
        parsedYuan: asCent / 100,
      }
    }
  }

  return {
    cent: Math.round(num * 100),
    strategy: 'heuristic_yuan',
    warnings: [],
    rawValue: raw,
    displayValue,
    parsedYuan: num,
  }
}

export function extractFieldPair(
  item: Record<string, unknown>,
  fieldName: string,
): { value: unknown; displayValue: unknown } {
  const field = item[fieldName]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    return { value: f.value, displayValue: f.displayValue }
  }
  return { value: item[fieldName], displayValue: undefined }
}

export function pickBillFieldPair(
  map: Record<string, unknown>,
  code: string,
): { value: unknown; displayValue: unknown } {
  const field = map[code]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    return { value: f.value, displayValue: f.displayValue }
  }
  return { value: undefined, displayValue: undefined }
}
