import { normalizeLuckyDrawListPayload } from './lucky-gift-normalize.service'
import type { NormalizedLuckyDraw } from './lucky-gift.types'

export type LuckyGiftSyncShopStatus =
  | 'success_with_data'
  | 'confirmed_empty'
  | 'partial_success'
  | 'ambiguous_empty'
  | 'auth_failed'
  | 'parse_failed'
  | 'request_failed'
  | 'parameter_failed'

export const LUCKY_GIFT_SYNC_STATUS_LABEL: Record<LuckyGiftSyncShopStatus, string> = {
  success_with_data: '拉到数据',
  confirmed_empty: '确认无数据',
  partial_success: '部分成功',
  ambiguous_empty: '返回空数据，尚不能确认该店无福袋',
  auth_failed: '登录失效',
  parse_failed: '解析异常',
  request_failed: '请求失败',
  parameter_failed: '参数错误',
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function isLuckyGiftLoginPageResponse(rawText: string): boolean {
  const t = String(rawText || '').trim().toLowerCase()
  return (
    t.includes('<html') ||
    t.includes('<!doctype') ||
    t.includes('login') && t.includes('xiaohongshu')
  )
}

export interface LuckyGiftParsedListPage {
  infos: NormalizedLuckyDraw[]
  totalCount: number | null
  rawIdTexts: string[]
  platformCode: number | null
  platformSuccess: boolean | null
  platformMsg: string | null
  resultCode: number | null
  resultMessage: string | null
  topKeys: string[]
  dataKeys: string[]
  listFieldFound: boolean
  rawLen: number
}

export function parseLuckyGiftListPage(payload: unknown, rawText: string): LuckyGiftParsedListPage {
  const root = asRecord(payload)
  const data1 = asRecord(root?.data) ?? root
  const data2 = asRecord(data1?.data) ?? data1
  const result = asRecord(data2?.result) ?? asRecord(data1?.result)
  const normalized = normalizeLuckyDrawListPayload(payload, rawText)
  const listFieldFound = Boolean(
    Array.isArray(data2?.infos) ||
      Array.isArray(data2?.list) ||
      Array.isArray(data2?.records) ||
      Array.isArray(data1?.infos) ||
      Array.isArray(data1?.list) ||
      Array.isArray(data1?.records),
  )
  const codeRaw = root?.code ?? data1?.code
  const platformCode =
    typeof codeRaw === 'number'
      ? codeRaw
      : typeof codeRaw === 'string' && /^-?\d+$/.test(codeRaw)
        ? Number(codeRaw)
        : null
  const resultCodeRaw = result?.code
  const resultCode =
    typeof resultCodeRaw === 'number'
      ? resultCodeRaw
      : typeof resultCodeRaw === 'string' && /^-?\d+$/.test(resultCodeRaw)
        ? Number(resultCodeRaw)
        : null
  return {
    infos: normalized.infos,
    totalCount: normalized.totalCount,
    rawIdTexts: normalized.rawIdTexts,
    platformCode,
    platformSuccess:
      typeof root?.success === 'boolean'
        ? root.success
        : typeof data1?.success === 'boolean'
          ? data1.success
          : null,
    platformMsg: String(root?.msg ?? data1?.msg ?? '').trim() || null,
    resultCode,
    resultMessage: String(result?.message ?? '').trim() || null,
    topKeys: root ? Object.keys(root).slice(0, 20) : [],
    dataKeys: data2 ? Object.keys(data2).slice(0, 30) : [],
    listFieldFound,
    rawLen: rawText.length,
  }
}

export function classifyLuckyGiftListPage(parsed: LuckyGiftParsedListPage, rawText: string): {
  status: LuckyGiftSyncShopStatus
  error?: string
} {
  if (!rawText.trim()) {
    return { status: 'request_failed', error: '响应体为空' }
  }
  if (isLuckyGiftLoginPageResponse(rawText)) {
    return { status: 'auth_failed', error: '接口返回登录页' }
  }
  if (parsed.platformCode != null && parsed.platformCode !== 0) {
    return {
      status: 'parameter_failed',
      error: parsed.platformMsg || `平台业务 code=${parsed.platformCode}`,
    }
  }
  if (parsed.platformSuccess === false) {
    return { status: 'parameter_failed', error: parsed.platformMsg || '平台 success=false' }
  }
  if (parsed.resultCode != null && parsed.resultCode !== 0) {
    return {
      status: 'parameter_failed',
      error: parsed.resultMessage || `result.code=${parsed.resultCode}`,
    }
  }
  if (parsed.totalCount != null && parsed.totalCount > 0 && !parsed.listFieldFound) {
    return { status: 'parse_failed', error: `total=${parsed.totalCount} 但列表字段缺失` }
  }
  if (parsed.totalCount != null && parsed.totalCount > 0 && parsed.infos.length === 0) {
    return { status: 'parse_failed', error: `total=${parsed.totalCount} 但解析列表为空` }
  }
  if (parsed.infos.length > 0) {
    const missingId = parsed.infos.some((d) => !d.luckyDrawId)
    if (missingId) return { status: 'parse_failed', error: '列表存在但 luckyDrawId 解析为空' }
    return { status: 'success_with_data' }
  }
  if (parsed.totalCount === 0) {
    return { status: 'confirmed_empty' }
  }
  return { status: 'ambiguous_empty' }
}
