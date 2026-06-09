/**
 * 品退判断：仅依据平台售后「退货原因」字段，白名单精确匹配。
 * 不使用聊天内容、订单状态或宽泛关键词。
 */

/** 品退白名单 — 仅以下原因计入品退 */
export const QUALITY_RETURN_REASON_WHITELIST = [
  '重量/数量/尺寸/规格与描述不符',
  '材质/颜色/款式与描述不符',
  '质量问题',
  '做工粗糙/有瑕疵',
  '商品破损/污渍',
  '资质/证书异常',
  '收到商品少件（含少配件）',
  '商家发错货',
  '空包裹',
] as const

/** 明确不算品退的原因 */
export const NON_QUALITY_RETURN_REASONS = [
  '多拍/拍错/不想要',
  '尺码/尺寸不合适',
  '其他',
  '仅退运费',
] as const

/** 非品退关键词（原因文本包含即排除，优先于品退关键词） */
const NON_QUALITY_RETURN_KEYWORD_PATTERNS = [
  '尺码/尺寸不合适',
  '尺寸不合适',
  '尺码不合适',
  '大了',
  '小了',
  '戴不上',
  '不喜欢',
  '多拍',
  '拍错',
  '不想要',
  '七天无理由',
  '仅退款',
  '其他个人原因',
  '价格原因',
  '买错了',
  '选错了',
  '地址填错',
  '拒收',
  '未按约定时间发货',
  '物流问题',
  '快递问题',
] as const

/** 尺码不合适 — 单独统计，不计入品退 */
export const SIZE_MISMATCH_REASONS = ['尺码/尺寸不合适'] as const

/** Excel 表头：仅匹配平台退货/售后原因列，不含聊天、问题描述 */
export function findReasonHeaders(allHeaders: string[]): string[] {
  const keys = ['退货原因', '售后原因', '退款原因', '买家申请原因', '申请原因']
  return allHeaders.filter((h) => keys.some((k) => h.includes(k)))
}

export function collectReasonText(row: Record<string, unknown>, headers: string[]): string {
  for (const h of headers) {
    const v = String(row[h] ?? '').trim()
    if (v) return v
  }
  return ''
}

/** 标准化为平台原因文本（用于精确匹配） */
export function normalizePlatformReason(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[／]/g, '/')
}

const NORMALIZED_WHITELIST = QUALITY_RETURN_REASON_WHITELIST.map((r) => normalizePlatformReason(r))
const NORMALIZED_NON_QUALITY = NON_QUALITY_RETURN_REASONS.map((r) => normalizePlatformReason(r))
const NORMALIZED_SIZE_MISMATCH = SIZE_MISMATCH_REASONS.map((r) => normalizePlatformReason(r))

/** 品退关键词（白名单未命中时的补充判断，匹配售后原因原文） */
const QUALITY_RETURN_KEYWORD_PATTERNS = [
  '商品问题',
  '商品质量问题',
  '质量问题',
  '商品瑕疵',
  '瑕疵',
  '破损',
  '损坏',
  '裂',
  '断',
  '坏了',
  '发错货',
  '错发',
  '漏发',
  '少件',
  '缺件',
  '与描述不符',
  '描述不符',
  '材质不符',
  '颜色不符',
  '货不对板',
  '假货',
  '假冒',
  '做工问题',
  '做工粗糙',
  '款式不符',
  '规格不符',
  '变形',
  '掉色',
  '开裂',
  '脏污',
  '污渍',
  '划痕',
  '砂眼',
  '棉裂',
  '有裂',
  '有纹裂',
  '商品无法使用',
  '功能异常',
  '空包裹',
  '资质',
  '证书异常',
]

function matchesNonQualityKeyword(normalized: string): boolean {
  if (!normalized) return false
  if (NORMALIZED_NON_QUALITY.includes(normalized)) return true
  if (NORMALIZED_SIZE_MISMATCH.includes(normalized)) return true
  return NON_QUALITY_RETURN_KEYWORD_PATTERNS.some((kw) =>
    normalized.includes(normalizePlatformReason(kw)),
  )
}

function matchesQualityKeyword(normalized: string): boolean {
  if (!normalized) return false
  if (matchesNonQualityKeyword(normalized)) return false
  return QUALITY_RETURN_KEYWORD_PATTERNS.some((kw) =>
    normalized.includes(normalizePlatformReason(kw)),
  )
}

export interface PlatformReasonMatch {
  /** 原始原因文案（展示用） */
  rawReason: string
  normalized: string
  isQualityReturn: boolean
  isSizeMismatch: boolean
  isNonQualityReason: boolean
}

export function matchPlatformReturnReason(reasonText: string): PlatformReasonMatch {
  const rawReason = reasonText.trim()
  const normalized = normalizePlatformReason(rawReason)

  if (!normalized) {
    return {
      rawReason: '',
      normalized: '',
      isQualityReturn: false,
      isSizeMismatch: false,
      isNonQualityReason: false,
    }
  }

  if (NORMALIZED_WHITELIST.includes(normalized)) {
    return {
      rawReason,
      normalized,
      isQualityReturn: true,
      isSizeMismatch: false,
      isNonQualityReason: false,
    }
  }

  if (NORMALIZED_SIZE_MISMATCH.includes(normalized)) {
    return {
      rawReason,
      normalized,
      isQualityReturn: false,
      isSizeMismatch: true,
      isNonQualityReason: true,
    }
  }

  if (NORMALIZED_NON_QUALITY.includes(normalized)) {
    return {
      rawReason,
      normalized,
      isQualityReturn: false,
      isSizeMismatch: false,
      isNonQualityReason: true,
    }
  }

  if (matchesNonQualityKeyword(normalized)) {
    return {
      rawReason,
      normalized,
      isQualityReturn: false,
      isSizeMismatch: NORMALIZED_SIZE_MISMATCH.includes(normalized),
      isNonQualityReason: true,
    }
  }

  if (matchesQualityKeyword(normalized)) {
    return {
      rawReason,
      normalized,
      isQualityReturn: true,
      isSizeMismatch: false,
      isNonQualityReason: false,
    }
  }

  return {
    rawReason,
    normalized,
    isQualityReturn: false,
    isSizeMismatch: false,
    isNonQualityReason: false,
  }
}

/** @deprecated 请使用 matchPlatformReturnReason；保留兼容，仅白名单精确匹配 */
export function isQualityReturnReason(text: string): boolean {
  return matchPlatformReturnReason(text).isQualityReturn
}
