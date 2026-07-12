/**
 * 福袋完整地址生成：避免「省+市+detail」重复拼接。
 * HAR 样例 detail 已含区县/市名：房山区北京市房山区良乡镇（南刘庄村）
 */
export function buildLuckyGiftFullAddress(input: {
  province?: string | null
  city?: string | null
  district?: string | null
  detail?: string | null
}): string {
  const province = String(input.province ?? '').trim()
  const city = String(input.city ?? '').trim()
  const district = String(input.district ?? '').trim()
  const detail = String(input.detail ?? '').trim()

  if (!detail && !province && !city && !district) return ''

  const parts: string[] = []
  const haystack = detail

  if (province && !containsPlace(haystack, province)) {
    parts.push(province)
  }
  if (city && !containsPlace(haystack, city) && city !== province) {
    parts.push(city)
  }
  if (district && !containsPlace(haystack, district) && district !== city) {
    parts.push(district)
  }
  if (detail) parts.push(detail)

  return parts.join('').trim() || detail || [province, city, district].filter(Boolean).join('')
}

function containsPlace(haystack: string, place: string): boolean {
  if (!haystack || !place) return false
  if (haystack.includes(place)) return true
  // 「北京」vs「北京市」
  const stripped = place.replace(/(省|市|自治区|特别行政区|区|县)$/u, '')
  if (stripped && stripped.length >= 2 && haystack.includes(stripped)) return true
  return false
}

export function evaluateLuckyGiftAddress(input: {
  name?: string | null
  phone?: string | null
  province?: string | null
  city?: string | null
  district?: string | null
  detail?: string | null
  hasAddressObject: boolean
}): {
  hasAddress: boolean
  addressComplete: boolean
  missing: string[]
  fullAddress: string | null
  fields: {
    name: string
    phone: string
    province: string
    city: string
    district: string
    detail: string
  }
} {
  const fields = {
    name: String(input.name ?? '').trim(),
    phone: String(input.phone ?? '').trim(),
    province: String(input.province ?? '').trim(),
    city: String(input.city ?? '').trim(),
    district: String(input.district ?? '').trim(),
    detail: String(input.detail ?? '').trim(),
  }

  if (!input.hasAddressObject) {
    return {
      hasAddress: false,
      addressComplete: false,
      missing: ['收件人', '手机号', '详细地址'],
      fullAddress: null,
      fields,
    }
  }

  const missing: string[] = []
  if (!fields.name) missing.push('收件人')
  if (!fields.phone) missing.push('手机号')
  if (!fields.detail && !fields.province && !fields.city) missing.push('详细地址')

  const fullAddress = buildLuckyGiftFullAddress(fields) || null
  const addressComplete = missing.length === 0 && Boolean(fullAddress)

  return {
    hasAddress: true,
    addressComplete,
    missing,
    fullAddress,
    fields,
  }
}
