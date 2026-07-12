import crypto from 'node:crypto'

const SF_PROD = 'https://sfapi.sf-express.com/std/service'
const SF_SBOX = 'https://sfapi-sbox.sf-express.com/std/service'

export type SfWaybillConfig = {
  partnerID: string
  checkWord: string
  checkWordSandbox?: string
  monthlyCard?: string
  phoneLast4?: string
  sandbox?: boolean
}

export type SfWaybillFeeResult = {
  waybill: string
  ok: boolean
  totalFeeYuan: number | null
  error: string | null
  apiCode: string | null
  notBilled: boolean
}

function sfMsgDigest(msgData: string, timestamp: number, checkWord: string): string {
  const raw = `${msgData}${timestamp}${checkWord}`
  return crypto.createHash('md5').update(raw, 'utf8').digest('base64')
}

function buildMsgData(waybill: string, cfg: SfWaybillConfig): string {
  const payload: Record<string, string> = {
    trackingType: '2',
    trackingNum: waybill.trim().toUpperCase(),
  }
  const phone = String(cfg.phoneLast4 || '').trim()
  if (phone) payload.phone = phone
  const card = String(cfg.monthlyCard || '').trim()
  if (card) payload.monthlyCard = card
  return JSON.stringify(payload)
}

function resolveCheckWord(cfg: SfWaybillConfig): string {
  if (cfg.sandbox) return String(cfg.checkWordSandbox || cfg.checkWord || '').trim()
  return String(cfg.checkWord || '').trim()
}

function parseFeeResult(waybill: string, outer: Record<string, unknown>, inner: Record<string, unknown>): SfWaybillFeeResult {
  const outerCode = String(outer.apiResultCode || '').trim()
  if (outerCode && outerCode !== 'A1000') {
    return {
      waybill,
      ok: false,
      totalFeeYuan: null,
      error: String(outer.apiErrorMsg || `丰桥外层错误 ${outerCode}`),
      apiCode: outerCode,
      notBilled: false,
    }
  }
  const success = inner.success === true || inner.success === 'true'
  if (!success) {
    const code = String(inner.errorCode || outerCode || '').trim()
    let error = String(inner.errorMsg || outer.apiErrorMsg || '查询失败')
    const notBilled = code === '8148' || /没有运单信息|暂未出账/.test(error)
    if (code === '8151' || /没有传入月结卡号/.test(error)) {
      error = '未关联月结卡号'
    }
    return { waybill, ok: false, totalFeeYuan: null, error, apiCode: code || null, notBilled }
  }
  const data = (inner.msgData ?? inner) as Record<string, unknown>
  const info = (data.waybillInfo ?? {}) as Record<string, unknown>
  const fees = Array.isArray(data.waybillFeeList) ? data.waybillFeeList : []
  let total = fees.reduce((s: number, f: Record<string, unknown>) => {
    return s + (Number(f.feeAmt ?? f.value) || 0)
  }, 0)
  if (!total) total = Number(info.totalFee) || 0
  return {
    waybill: String(info.waybillNo || waybill),
    ok: true,
    totalFeeYuan: Math.round(total * 100) / 100,
    error: null,
    apiCode: 'S0000',
    notBilled: false,
  }
}

export function loadSfWaybillConfigFromEnv(): SfWaybillConfig | null {
  const partnerID = String(process.env.SF_PARTNER_ID || '').trim()
  const checkWord = String(process.env.SF_CHECK_WORD || '').trim()
  const monthlyCard = String(process.env.SF_MONTHLY_CARD || '').trim()
  const sandbox = process.env.SF_SANDBOX === '1' || process.env.SF_SANDBOX === 'true'
  if (!partnerID || !checkWord) return null
  if (!sandbox && !monthlyCard) return null
  return {
    partnerID,
    checkWord,
    checkWordSandbox: String(process.env.SF_CHECK_WORD_SANDBOX || '').trim() || undefined,
    monthlyCard: monthlyCard || undefined,
    phoneLast4: String(process.env.SF_PHONE_LAST4 || '').trim() || undefined,
    sandbox,
  }
}

export async function querySfWaybillFee(
  waybill: string,
  cfg: SfWaybillConfig,
  signal?: AbortSignal,
): Promise<SfWaybillFeeResult> {
  const no = String(waybill || '').trim().toUpperCase()
  if (!/^SF\d{10,}$/.test(no)) {
    return { waybill: no, ok: false, totalFeeYuan: null, error: '非顺丰运单号', apiCode: null, notBilled: false }
  }
  const partnerID = String(cfg.partnerID || '').trim()
  const checkWord = resolveCheckWord(cfg)
  if (!partnerID || !checkWord) {
    return { waybill: no, ok: false, totalFeeYuan: null, error: '顺丰配置缺失', apiCode: null, notBilled: false }
  }

  const msgData = buildMsgData(no, cfg)
  const timestamp = Date.now()
  const msgDigest = sfMsgDigest(msgData, timestamp, checkWord)
  const body = new URLSearchParams({
    partnerID,
    requestID: crypto.randomUUID().replace(/-/g, ''),
    serviceCode: 'EXP_RECE_QUERY_SFWAYBILL',
    timestamp: String(timestamp),
    msgDigest,
    msgData,
  })
  const url = cfg.sandbox ? SF_SBOX : SF_PROD

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
      signal: signal ?? AbortSignal.timeout(25_000),
    })
    const text = await res.text()
    let outer: Record<string, unknown>
    try {
      outer = JSON.parse(text) as Record<string, unknown>
    } catch {
      return { waybill: no, ok: false, totalFeeYuan: null, error: '响应非 JSON', apiCode: null, notBilled: false }
    }
    let inner: Record<string, unknown> = outer
    if (typeof outer.apiResultData === 'string') {
      try {
        inner = JSON.parse(outer.apiResultData) as Record<string, unknown>
      } catch {
        inner = { success: false, errorMsg: 'apiResultData 解析失败' }
      }
    }
    return parseFeeResult(no, outer, inner)
  } catch (err) {
    return {
      waybill: no,
      ok: false,
      totalFeeYuan: null,
      error: err instanceof Error ? err.message : String(err),
      apiCode: null,
      notBilled: false,
    }
  }
}
