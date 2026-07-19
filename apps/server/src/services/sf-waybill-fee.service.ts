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

export type SfRouteNode = {
  acceptTime: string | null
  acceptAddress: string | null
  remark: string
  opCode: string
}

export type SfRouteOutcome = 'unknown' | 'in_transit' | 'signed' | 'rejected' | 'returned' | 'failed'

export type SfWaybillRouteResult = {
  waybill: string
  ok: boolean
  outcome: SfRouteOutcome
  label: string | null
  nodes: SfRouteNode[]
  error: string | null
  apiCode: string | null
}

function sfMsgDigest(msgData: string, timestamp: number, checkWord: string): string {
  const raw = `${msgData}${timestamp}${checkWord}`
  return crypto.createHash('md5').update(raw, 'utf8').digest('base64')
}

function buildFeeMsgData(waybill: string, cfg: SfWaybillConfig): string {
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

function parseFeeResult(
  waybill: string,
  outer: Record<string, unknown>,
  inner: Record<string, unknown>,
): SfWaybillFeeResult {
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

async function postSfService(
  serviceCode: string,
  msgData: string,
  cfg: SfWaybillConfig,
  signal?: AbortSignal,
): Promise<{ outer: Record<string, unknown>; inner: Record<string, unknown> } | { error: string }> {
  const partnerID = String(cfg.partnerID || '').trim()
  const checkWord = resolveCheckWord(cfg)
  if (!partnerID || !checkWord) return { error: '顺丰配置缺失' }

  const timestamp = Date.now()
  const msgDigest = sfMsgDigest(msgData, timestamp, checkWord)
  const body = new URLSearchParams({
    partnerID,
    requestID: crypto.randomUUID().replace(/-/g, ''),
    serviceCode,
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
      return { error: '响应非 JSON' }
    }
    let inner: Record<string, unknown> = outer
    if (typeof outer.apiResultData === 'string') {
      try {
        inner = JSON.parse(outer.apiResultData) as Record<string, unknown>
      } catch {
        inner = { success: false, errorMsg: 'apiResultData 解析失败' }
      }
    }
    return { outer, inner }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
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
  const msgData = buildFeeMsgData(no, cfg)
  const posted = await postSfService('EXP_RECE_QUERY_SFWAYBILL', msgData, cfg, signal)
  if ('error' in posted) {
    return { waybill: no, ok: false, totalFeeYuan: null, error: posted.error, apiCode: null, notBilled: false }
  }
  return parseFeeResult(no, posted.outer, posted.inner)
}

function phoneLast4(raw: string | null | undefined): string | null {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(-4)
}

export function classifySfRouteNodes(nodes: SfRouteNode[]): {
  outcome: Exclude<SfRouteOutcome, 'failed'>
  label: string | null
} {
  if (nodes.length === 0) return { outcome: 'unknown', label: null }
  const sorted = [...nodes].sort((a, b) => {
    const ta = a.acceptTime ? Date.parse(a.acceptTime.replace(/-/g, '/')) : 0
    const tb = b.acceptTime ? Date.parse(b.acceptTime.replace(/-/g, '/')) : 0
    return ta - tb
  })
  const blob = sorted.map((n) => `${n.opCode} ${n.remark}`).join('\n')
  const last = sorted[sorted.length - 1]
  const label = last?.remark?.trim() || null

  if (/拒收|客户拒签|收方拒|拒签|收件人拒/.test(blob)) {
    return { outcome: 'rejected', label }
  }
  if (
    sorted.some((n) => n.opCode === '648') ||
    /快件已退回|退回寄件|退回\/转寄|退件入库|退回中/.test(blob)
  ) {
    return { outcome: 'returned', label }
  }
  if (
    sorted.some((n) => n.opCode === '80' || /已签收|签收人/.test(n.remark))
  ) {
    return { outcome: 'signed', label }
  }
  return { outcome: 'in_transit', label }
}

function parseRouteResult(
  waybill: string,
  outer: Record<string, unknown>,
  inner: Record<string, unknown>,
): SfWaybillRouteResult {
  const outerCode = String(outer.apiResultCode || '').trim()
  if (outerCode && outerCode !== 'A1000') {
    return {
      waybill,
      ok: false,
      outcome: 'failed',
      label: null,
      nodes: [],
      error: String(outer.apiErrorMsg || `丰桥外层错误 ${outerCode}`),
      apiCode: outerCode,
    }
  }
  const success = inner.success === true || inner.success === 'true'
  if (!success) {
    const code = String(inner.errorCode || outerCode || '').trim()
    const error = String(inner.errorMsg || outer.apiErrorMsg || '路由查询失败')
    return {
      waybill,
      ok: false,
      outcome: 'failed',
      label: null,
      nodes: [],
      error,
      apiCode: code || null,
    }
  }

  const data = (inner.msgData ?? inner) as Record<string, unknown>
  const routeResp = Array.isArray(data.routeResps) ? data.routeResps : []
  const first = (routeResp[0] ?? {}) as Record<string, unknown>
  const rawNodes = Array.isArray(first.routes) ? first.routes : []
  const nodes: SfRouteNode[] = rawNodes.map((n: Record<string, unknown>) => ({
    acceptTime: n.acceptTime != null ? String(n.acceptTime) : null,
    acceptAddress: n.acceptAddress != null ? String(n.acceptAddress) : null,
    remark: String(n.remark ?? n.remarkZh ?? ''),
    opCode: String(n.opCode ?? ''),
  }))
  const classified = classifySfRouteNodes(nodes)
  return {
    waybill: String(first.mailNo || waybill),
    ok: true,
    outcome: classified.outcome,
    label: classified.label,
    nodes,
    error: null,
    apiCode: 'S0000',
  }
}

/** 路由查询：优先用收件手机后四位，否则回落 SF_PHONE_LAST4。
 * 生产未上线路由权限（A1004）时，自动用沙箱校验码重试（实测可返回真实轨迹）。
 */
export async function querySfWaybillRoute(
  waybill: string,
  cfg: SfWaybillConfig,
  options?: { phone?: string | null; signal?: AbortSignal },
): Promise<SfWaybillRouteResult> {
  const no = String(waybill || '').trim().toUpperCase()
  if (!/^SF\d{10,}$/.test(no)) {
    return {
      waybill: no,
      ok: false,
      outcome: 'failed',
      label: null,
      nodes: [],
      error: '非顺丰运单号',
      apiCode: null,
    }
  }

  const primary = await querySfWaybillRouteOnce(no, cfg, options)
  if (primary.ok) return primary

  const needSandboxFallback =
    !cfg.sandbox &&
    Boolean(cfg.checkWordSandbox) &&
    (primary.apiCode === 'A1004' || /无对应服务权限/.test(primary.error || ''))
  if (!needSandboxFallback) return primary

  const sandboxResult = await querySfWaybillRouteOnce(
    no,
    { ...cfg, sandbox: true },
    options,
  )
  if (sandboxResult.ok) return sandboxResult
  // 保留生产错误信息，便于排查权限
  return {
    ...sandboxResult,
    error: primary.error || sandboxResult.error,
    apiCode: primary.apiCode || sandboxResult.apiCode,
  }
}

async function querySfWaybillRouteOnce(
  waybill: string,
  cfg: SfWaybillConfig,
  options?: { phone?: string | null; signal?: AbortSignal },
): Promise<SfWaybillRouteResult> {
  const checkPhone =
    phoneLast4(options?.phone) || phoneLast4(cfg.phoneLast4) || String(cfg.phoneLast4 || '').trim() || ''
  const payload: Record<string, unknown> = {
    language: '0',
    trackingType: '1',
    trackingNumber: [waybill],
    methodType: '1',
  }
  if (checkPhone) payload.checkPhoneNo = checkPhone
  const msgData = JSON.stringify(payload)
  const posted = await postSfService('EXP_RECE_SEARCH_ROUTES', msgData, cfg, options?.signal)
  if ('error' in posted) {
    return {
      waybill,
      ok: false,
      outcome: 'failed',
      label: null,
      nodes: [],
      error: posted.error,
      apiCode: null,
    }
  }
  return parseRouteResult(waybill, posted.outer, posted.inner)
}
