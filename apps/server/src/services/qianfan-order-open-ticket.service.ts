/**
 * 千帆订单详情换票（对齐 saomaqiang apps/xiangyu/server/services/arkSsoTicketService.js）
 */
import { prisma } from '../lib/prisma'
import { signXhsRequest } from './xhs-sign.service'
import { listEnabledLiveAccountsWithCookie, getDecryptedCookieByAccountId } from './live-account.service'
import { resolveLiveAccountCookie } from './qianfan-cookie-resolver.service'
import { resolveCanonicalShopName } from '../config/qianfan-shops.constants'
import {
  getGoodReviewShopName,
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import { logInfo, logWarn } from '../utils/server-log'

const SERVICE_TICKET_URL = 'https://customer.xiaohongshu.com/api/cas/customer/web/service-ticket'
const ARK_ROOT = 'https://ark.xiaohongshu.com'
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const TICKET_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 12_000

export type QianfanOrderTicketSource = 'good-review' | 'board' | 'after-sales'

type TicketEntry = {
  redirectUrl: string
  createdAt: number
  used: boolean
}

const ticketStore = new Map<string, TicketEntry>()

export interface QianfanTicketAttempt {
  accountName: string
  shopKey?: string
  cookieSource: string
  bodyType: string
  serviceMode: 'raw' | 'encoded' | 'arkRoot'
  origin: string
  referer: string
  httpStatus?: number
  platformCode?: number | string
  platformMsg?: string
  ticketFound: boolean
  ticketPrefix?: 'ST' | 'AT'
}

export interface QianfanOrderDetailResolveResult {
  ok: boolean
  orderId: string
  packageId: string
  shop: string
  shopName: string
  serviceUrl: string
  finalOpenUrl: string
  hasTicket: boolean
  fallbackToBaseUrl: boolean
  attempts: QianfanTicketAttempt[]
  error?: string
}

interface CookieCandidate {
  cookie: string
  accountName: string
  accountId: string
  shopKey?: string
  cookieSource: string
}

interface TicketBodySpec {
  body: Record<string, unknown>
  tag: string
}

interface HeaderVariant {
  tag: string
  origin?: string
  referer?: string
  authorization?: string
}

function parseCookieMap(cookie: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return out
}

function extractAuthorizationFromCookie(cookie: string): string {
  const m = parseCookieMap(cookie)
  for (const [key, val] of Object.entries(m)) {
    if (!key.includes('access-token-ark') || key.includes('beta')) continue
    const v = String(val || '').trim()
    if (v.startsWith('customer.ark.')) return v.slice('customer.ark.'.length)
    if (v) return v
  }
  return ''
}

function extractFuwuAuthorization(cookie: string): string {
  const m = parseCookieMap(cookie)
  for (const [key, val] of Object.entries(m)) {
    if (!key.includes('access-token-fuwu') || key.includes('beta')) continue
    const v = String(val || '').trim()
    if (v.startsWith('customer.fuwu.')) return v.slice('customer.fuwu.'.length)
    if (v) return v
  }
  return ''
}

function extractSellerUserIdFromCookie(cookie: string): string {
  return String(parseCookieMap(cookie)['x-user-id-ark.xiaohongshu.com'] || '').trim()
}

export function normalizePackageId(packageId: string): string {
  const raw = String(packageId || '').trim()
  if (!raw) return ''
  return raw.startsWith('P') ? raw : `P${raw}`
}

export function buildDetailServiceUrl(packageId: string): string {
  const pkg = normalizePackageId(packageId)
  if (!pkg) return ''
  return `${ARK_ROOT}/app-order/order/detail/${encodeURIComponent(pkg)}`
}

function getOrderDetailUrlTemplate(): string | null {
  return process.env.QIANFAN_ORDER_DETAIL_URL_TEMPLATE?.trim() || null
}

function buildConfiguredDetailUrl(orderId: string): string | null {
  const tpl = getOrderDetailUrlTemplate()
  if (!tpl) return null
  return tpl
    .replace(/\{orderId\}/g, encodeURIComponent(orderId))
    .replace(/\{packageId\}/g, encodeURIComponent(normalizePackageId(orderId)))
}

export function extractTicketFromResponse(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const obj = data as Record<string, unknown>
  const nested =
    obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : undefined
  const direct = nested?.ticket ?? obj.ticket ?? nested?.st ?? ''
  const s = String(direct ?? '').trim()
  if (s.startsWith('ST-')) return s
  return ''
}

function ticketPrefix(ticket: string): 'ST' | 'AT' | undefined {
  if (ticket.startsWith('ST-')) return 'ST'
  if (ticket.startsWith('AT-')) return 'AT'
  return undefined
}

function serviceModeFromBody(body: Record<string, unknown>): 'raw' | 'encoded' | 'arkRoot' {
  const service = String(body.service ?? '')
  if (service === ARK_ROOT) return 'arkRoot'
  if (service.startsWith('http://') || service.startsWith('https://')) return 'raw'
  return 'encoded'
}

/** 对齐 saomaqiang buildTicketRequestBodies */
export function buildTicketRequestBodies(serviceUrl: string, cookie: string): TicketBodySpec[] {
  const m = parseCookieMap(cookie)
  const sid = String(m['customer-sso-sid'] || '').trim()
  const auth = extractAuthorizationFromCookie(cookie)
  const sellerId = String(m['x-user-id-ark.xiaohongshu.com'] || '').trim()
  const webSession = String(m.web_session || '').trim()
  const enc = encodeURIComponent(serviceUrl)
  const bodies: TicketBodySpec[] = []
  const push = (body: Record<string, unknown>, tag: string) => bodies.push({ body, tag })

  push({ service: ARK_ROOT, type: 'at' }, 'at+root')
  push({ service: encodeURIComponent(ARK_ROOT), type: 'at' }, 'at+root-enc')
  if (sid) push({ service: ARK_ROOT, type: 'at', sid, source: '' }, 'at+root+sid')

  if (sid) {
    for (const type of ['st', 'sso'] as const) {
      push({ service: enc, type, sid, source: '' }, `${type}+sid`)
      push({ service: enc, type, customerSid: sid, source: '' }, `${type}+customerSid`)
      push({ service: enc, type, ssoSid: sid, source: '' }, `${type}+ssoSid`)
      push({ service: serviceUrl, type, sid, source: '' }, `${type}+sid+rawService`)
    }
  }

  if (sid && auth) {
    push({ service: enc, type: 'st', sid, accessToken: auth, source: '' }, 'st+sid+at')
    push({ service: enc, type: 'sso', sid, accessToken: auth, source: '' }, 'sso+sid+at')
  }

  if (sid && sellerId) {
    push({ service: enc, type: 'sso', sid, sellerId, source: '' }, 'sso+sid+seller')
    push({ service: enc, type: 'st', sid, sellerId, source: '' }, 'st+sid+seller')
  }

  if (webSession) {
    push({ service: enc, type: 'sso', webSession, source: '' }, 'sso+webSession')
    push({ service: enc, type: 'st', webSession, source: '' }, 'st+webSession')
    push({ service: enc, type: 'sso', session: webSession, source: '' }, 'sso+session')
  }

  const homeEnc = encodeURIComponent(`${ARK_ROOT}/app-system/home`)
  if (sid) {
    for (const type of ['st', 'sso'] as const) {
      push({ service: homeEnc, type, sid, source: '' }, `${type}+sid+home`)
    }
    push({ service: enc, type: 'sso', source: '' }, 'sso-only')
  }

  if (sellerId) {
    for (const type of ['sso', 'st'] as const) {
      bodies.unshift({ body: { service: enc, type, sellerId, source: '' }, tag: `${type}+sellerOnly` })
      if (sid) {
        bodies.unshift({
          body: { service: enc, type, sid, sellerId, source: '' },
          tag: `${type}+sid+seller-priority`,
        })
      }
    }
  }

  return bodies
}

function buildHeaderVariants(cookie: string): HeaderVariant[] {
  const fuwuAuth = extractFuwuAuthorization(cookie)
  const arkAuth = extractAuthorizationFromCookie(cookie)
  const variants: HeaderVariant[] = [{ tag: 'customer' }]
  variants.push({
    tag: 'ark',
    origin: 'https://ark.xiaohongshu.com',
    referer: 'https://ark.xiaohongshu.com/app-order/aftersale/list',
    authorization: arkAuth,
  })
  if (fuwuAuth || arkAuth) {
    variants.push({
      tag: 'walle',
      origin: 'https://walle.xiaohongshu.com',
      referer: 'https://walle.xiaohongshu.com/cstools/seller/dashboard',
      authorization: fuwuAuth || arkAuth,
    })
  }
  return variants
}

async function postServiceTicketDetailed(
  cookie: string,
  body: Record<string, unknown>,
  bodyType: string,
  opts: HeaderVariant,
): Promise<{ ticket: string; httpStatus: number; platformCode?: number | string; platformMsg?: string }> {
  const signed = await signXhsRequest({
    method: 'POST',
    url: SERVICE_TICKET_URL,
    body,
    cookie,
    logContext: { tag: 'xhs-sign' },
  })
  const origin = opts.origin || 'https://customer.xiaohongshu.com'
  const referer = opts.referer || 'https://customer.xiaohongshu.com/'
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    origin,
    referer,
    'user-agent': DEFAULT_UA,
    cookie,
    'x-s': signed['x-s'],
    'x-t': signed['x-t'],
    'x-s-common': signed['x-s-common'],
  }
  if (opts.authorization || signed.authorization) {
    headers.authorization = opts.authorization || signed.authorization
  }

  const res = await fetch(SERVICE_TICKET_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = JSON.parse(text)
  } catch {
    return { ticket: '', httpStatus: res.status }
  }

  const root = data as Record<string, unknown>
  const platformCode = root.code as number | string | undefined
  const platformMsg = String(root.msg ?? root.message ?? '').trim() || undefined

  if (!res.ok) {
    return { ticket: '', httpStatus: res.status, platformCode, platformMsg }
  }

  const ticket = extractTicketFromResponse(data)
  if (ticket) return { ticket, httpStatus: res.status, platformCode, platformMsg }

  if (platformMsg && /登录|过期|鉴权|token/i.test(platformMsg)) {
    throw new Error('店铺 Cookie 可能已过期，请在系统设置重新粘贴')
  }

  return { ticket: '', httpStatus: res.status, platformCode, platformMsg }
}

async function fetchTicketWithCookieDetailed(
  cookie: string,
  serviceUrl: string,
  candidate: CookieCandidate,
): Promise<{ ticket: string; attempts: QianfanTicketAttempt[] }> {
  const attempts: QianfanTicketAttempt[] = []
  const bodySpecs = buildTicketRequestBodies(serviceUrl, cookie)
  const headerVariants = buildHeaderVariants(cookie)

  for (const hv of headerVariants) {
    if (hv.tag === 'walle' && !hv.authorization) continue
    for (const { body, tag } of bodySpecs) {
      const origin = hv.origin || 'https://customer.xiaohongshu.com'
      const referer = hv.referer || 'https://customer.xiaohongshu.com/'
      const attemptBase: Omit<QianfanTicketAttempt, 'ticketFound'> = {
        accountName: candidate.accountName,
        shopKey: candidate.shopKey,
        cookieSource: candidate.cookieSource,
        bodyType: tag,
        serviceMode: serviceModeFromBody(body),
        origin,
        referer,
      }
      try {
        const result = await postServiceTicketDetailed(cookie, body, tag, hv)
        const ticketFound = Boolean(result.ticket)
        attempts.push({
          ...attemptBase,
          httpStatus: result.httpStatus,
          platformCode: result.platformCode,
          platformMsg: result.platformMsg,
          ticketFound,
          ticketPrefix: result.ticket ? ticketPrefix(result.ticket) : undefined,
        })
        logInfo(
          '千帆换票',
          `${candidate.accountName}/${candidate.cookieSource} ${tag}@${hv.tag} ticket=${ticketFound}`,
        )
        if (result.ticket) return { ticket: result.ticket, attempts }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        attempts.push({
          ...attemptBase,
          platformMsg: msg,
          ticketFound: false,
        })
        logWarn('千帆换票', `${candidate.accountName} ${tag}: ${msg}`)
      }
    }
  }

  return { ticket: '', attempts }
}

export function buildArkUrlWithTicketDirect(serviceUrl: string, ticket: string): string {
  const base = String(serviceUrl || '').trim()
  const st = String(ticket || '').trim()
  if (!base || !st.startsWith('ST-')) return base
  const u = new URL(base)
  u.searchParams.set('ticket', st)
  return u.toString()
}

export function buildArkSsologinUrl(serviceUrl: string, ticket: string): string {
  const base = String(serviceUrl || '').trim()
  const st = String(ticket || '').trim()
  if (!base || !st.startsWith('ST-')) return base
  const params = new URLSearchParams({ service: base, ticket: st })
  return `${ARK_ROOT}/app-sso/ssologin?${params.toString()}`
}

async function resolveCookieCandidates(orderNo: string, shopKeyOrName?: string): Promise<CookieCandidate[]> {
  const out: CookieCandidate[] = []
  const seen = new Set<string>()
  const push = (item: CookieCandidate) => {
    const text = item.cookie.trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    out.push(item)
  }

  if (shopKeyOrName) {
    const shop = await resolveCookieForShopStrict(shopKeyOrName)
    if (shop) {
      push({
        cookie: shop.cookie,
        accountName: shop.shopName,
        accountId: shop.accountId,
        shopKey: shop.shopKey,
        cookieSource: 'shop',
      })
    }
  }

  const normalized = normalizePackageId(orderNo)
  const row = await prisma.xhsRawOrder.findFirst({
    where: {
      OR: [{ packageId: normalized }, { packageId: orderNo }, { orderId: orderNo }],
    },
    orderBy: { orderTime: 'desc' },
  })

  const accounts = await listEnabledLiveAccountsWithCookie()

  if (row?.liveAccountId) {
    const acc = accounts.find((a) => a.id === row.liveAccountId)
    try {
      const cookie = await getDecryptedCookieByAccountId(row.liveAccountId)
      if (cookie) {
        push({
          cookie,
          accountName: acc?.name || row.liveAccountName || '订单关联账号',
          accountId: row.liveAccountId,
          cookieSource: 'order_live_account_id',
        })
      }
    } catch {
      // ignore
    }
  }

  if (row?.liveAccountName) {
    const acc = accounts.find((a) => (a.name || '').trim() === (row.liveAccountName || '').trim())
    if (acc) {
      try {
        const cookie = await getDecryptedCookieByAccountId(acc.id)
        if (cookie) {
          push({
            cookie,
            accountName: acc.name,
            accountId: acc.id,
            cookieSource: 'order_live_account_name',
          })
        }
      } catch {
        // ignore
      }
    }
  }

  for (const acc of accounts) {
    try {
      const cookie = await getDecryptedCookieByAccountId(acc.id)
      if (cookie) {
        push({
          cookie,
          accountName: acc.name,
          accountId: acc.id,
          cookieSource: 'fallback_poll',
        })
      }
    } catch {
      // ignore
    }
  }

  return out
}

export class QianfanOrderOpenTicketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QianfanOrderOpenTicketError'
  }
}

export async function resolveQianfanOrderDetail(params: {
  orderId: string
  shop?: string
  source?: QianfanOrderTicketSource
}): Promise<QianfanOrderDetailResolveResult> {
  const orderId = String(params.orderId || '').trim()
  const shopInput = String(params.shop || '').trim()
  const shopKey = resolveGoodReviewShopKey(shopInput)
  const packageId = normalizePackageId(orderId)

  const emptyResult = (error: string): QianfanOrderDetailResolveResult => ({
    ok: false,
    orderId,
    packageId,
    shop: shopKey || shopInput,
    shopName: shopKey ? getGoodReviewShopName(shopKey) : shopInput || '未知店铺',
    serviceUrl: '',
    finalOpenUrl: '',
    hasTicket: false,
    fallbackToBaseUrl: false,
    attempts: [],
    error,
  })

  if (!orderId) return emptyResult('请提供订单号')
  if (!packageId) return emptyResult('请提供有效订单号')

  const serviceUrl = buildConfiguredDetailUrl(packageId) || buildDetailServiceUrl(packageId)
  if (!serviceUrl) return emptyResult('还没有配置订单详情地址')

  const shopName = shopKey ? getGoodReviewShopName(shopKey) : shopInput || '未知店铺'
  const candidates = await resolveCookieCandidates(orderId, shopInput || undefined)

  if (!candidates.length) {
    return {
      ok: false,
      orderId,
      packageId,
      shop: shopKey || shopInput,
      shopName,
      serviceUrl,
      finalOpenUrl: serviceUrl,
      hasTicket: false,
      fallbackToBaseUrl: true,
      attempts: [],
      error: '平台登录信息过期了，请到系统设置重新粘贴 Cookie。',
    }
  }

  const allAttempts: QianfanTicketAttempt[] = []
  let ticket = ''

  for (const candidate of candidates) {
    const result = await fetchTicketWithCookieDetailed(candidate.cookie, serviceUrl, candidate)
    allAttempts.push(...result.attempts)
    if (result.ticket) {
      ticket = result.ticket
      break
    }
  }

  if (ticket) {
    const finalOpenUrl = buildArkUrlWithTicketDirect(serviceUrl, ticket)
    return {
      ok: true,
      orderId,
      packageId,
      shop: shopKey || shopInput,
      shopName,
      serviceUrl,
      finalOpenUrl,
      hasTicket: true,
      fallbackToBaseUrl: false,
      attempts: allAttempts,
    }
  }

  return {
    ok: true,
    orderId,
    packageId,
    shop: shopKey || shopInput,
    shopName,
    serviceUrl,
    finalOpenUrl: serviceUrl,
    hasTicket: false,
    fallbackToBaseUrl: true,
    attempts: allAttempts,
    error: '未能换到 ST ticket，已回退到基础订单详情链接',
  }
}

export async function createQianfanOrderOpenTicket(
  orderNo: string,
  options?: { shop?: string; source?: QianfanOrderTicketSource },
): Promise<{
  ticket: string
  expiresInSeconds: number
  openUrl: string
  hasTicket: boolean
  fallbackToBaseUrl: boolean
}> {
  const resolved = await resolveQianfanOrderDetail({
    orderId: orderNo,
    shop: options?.shop,
    source: options?.source ?? 'board',
  })

  if (!resolved.serviceUrl) {
    throw new QianfanOrderOpenTicketError(resolved.error || '请提供订单号')
  }

  if (!resolved.finalOpenUrl) {
    throw new QianfanOrderOpenTicketError(resolved.error || '暂时无法打开订单详情')
  }

  const ticket = `qf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  ticketStore.set(ticket, {
    redirectUrl: resolved.finalOpenUrl,
    createdAt: Date.now(),
    used: false,
  })

  return {
    ticket,
    expiresInSeconds: 60,
    openUrl: `/api/board/qianfan-order-detail/open?ticket=${encodeURIComponent(ticket)}`,
    hasTicket: resolved.hasTicket,
    fallbackToBaseUrl: resolved.fallbackToBaseUrl,
  }
}

export function consumeQianfanOrderOpenTicket(ticket: string): {
  ok: true
  redirectUrl: string
} | {
  ok: false
  html: string
} {
  const key = String(ticket || '').trim()
  const entry = ticketStore.get(key)
  if (!entry) {
    return {
      ok: false,
      html: htmlErrorPage('这个订单详情入口已过期，请回到页面重新点一次。'),
    }
  }
  if (entry.used) {
    return {
      ok: false,
      html: htmlErrorPage('这个订单详情入口已过期，请回到页面重新点一次。'),
    }
  }
  if (Date.now() - entry.createdAt > TICKET_TTL_MS) {
    ticketStore.delete(key)
    return {
      ok: false,
      html: htmlErrorPage('这个订单详情入口已过期，请回到页面重新点一次。'),
    }
  }
  entry.used = true
  ticketStore.delete(key)
  return { ok: true, redirectUrl: entry.redirectUrl }
}

function htmlErrorPage(message: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>打开千帆订单详情</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#334155}
.box{background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:16px;margin:16px 0}
</style></head><body><h1>暂时打不开</h1><div class="box"><p>${message}</p></div></body></html>`
}

export function __testOnlyQianfanTicketCount(): number {
  return ticketStore.size
}

export function __testOnlySeedQianfanTicket(ticket: string, redirectUrl: string): void {
  ticketStore.set(ticket, { redirectUrl, createdAt: Date.now(), used: false })
}

export async function resolveCookieForShopStrict(shopKeyOrName: string): Promise<{
  cookie: string
  shopKey: GoodReviewShopKey
  shopName: string
  accountId: string
} | null> {
  const shopKey = resolveGoodReviewShopKey(shopKeyOrName)
  if (!shopKey) return null

  const shopName = getGoodReviewShopName(shopKey)
  const { resolveOfficialShopAccountForStatus } = await import('./official-shop-account.service')
  const official = await resolveOfficialShopAccountForStatus(shopKey)
  if (!official) return null

  const cookie = await resolveLiveAccountCookie(official.id, shopName)
  if (!cookie?.trim()) return null

  return { cookie, shopKey, shopName, accountId: official.id }
}

export async function buildGoodReviewArkOrderDetail(params: {
  orderId: string
  shop: string
}): Promise<QianfanOrderDetailResolveResult> {
  const orderId = String(params.orderId || '').trim()
  const shopInput = String(params.shop || '').trim()
  const shopKey = resolveGoodReviewShopKey(shopInput)
  if (!orderId) {
    return {
      ok: false,
      orderId: '',
      packageId: '',
      shop: shopInput,
      shopName: shopKey ? getGoodReviewShopName(shopKey) : shopInput || '未知店铺',
      serviceUrl: '',
      finalOpenUrl: '',
      hasTicket: false,
      fallbackToBaseUrl: false,
      attempts: [],
      error: '请提供订单号',
    }
  }
  if (!shopKey) {
    return {
      ok: false,
      orderId,
      packageId: normalizePackageId(orderId),
      shop: shopInput,
      shopName: shopInput || '未知店铺',
      serviceUrl: '',
      finalOpenUrl: '',
      hasTicket: false,
      fallbackToBaseUrl: false,
      attempts: [],
      error: '无效的店铺参数',
    }
  }
  return resolveQianfanOrderDetail({
    orderId,
    shop: shopInput,
    source: 'good-review',
  })
}

export function htmlGoodReviewArkOrderFallbackPage(params: {
  serviceUrl: string
  shopName: string
  message?: string
}): string {
  const msg = params.message?.trim() || '请提供有效参数'
  const safeMsg = msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeUrl = params.serviceUrl.replace(/"/g, '&quot;')
  const safeShop = params.shopName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const redirectScript = params.serviceUrl
    ? `<script>setTimeout(function(){ location.replace(${JSON.stringify(params.serviceUrl)}); }, 800);</script>`
    : ''
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>打开千帆订单详情</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#334155;line-height:1.6}
.box{background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:16px;margin:16px 0}
a{color:#e11d48;word-break:break-all}</style></head><body>
<h1>正在打开千帆订单详情</h1>
<p>店铺：${safeShop}</p>
<div class="box"><p>${safeMsg}</p></div>
<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>
${redirectScript}
</body></html>`
}
