import { URL } from 'node:url'
import {
  formatXhsApiError,
  formatXhsSignBridgeError,
  isXhsSignRelatedMessage,
} from '../utils/xhs-error'
import { isXhsAuthExpired, shouldStopSyncForHttpStatus, XhsAuthError } from '../utils/xhs-auth.util'
import { signXhsRequest } from './xhs-sign.service'
import { logXhsSyncRoundStopped } from '../utils/sync-cmd-log'
import { patchDownloadPipeline } from './download-pipeline-meta.service'
import { updateTaskApiDebug } from './download-task-api-debug.service'
import { writeOperationLog } from './audit.service'
import type { AuditAction } from '../types/audit'

export const XHS_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface XhsRequestAuditContext {
  userId?: string
  username?: string | null
  role?: string | null
  requestId?: string | null
  ip?: string | null
  userAgent?: string | null
  module?: string
  downloadTaskId?: string
}

export interface RequestXhsJsonOptions {
  method: 'GET' | 'POST'
  url: string
  body?: unknown
  cookie: string
  referer?: string
  needSign?: boolean
  /** 额外请求头（如 live-assistant 的 account-id）；不得传入 x-s/x-t 硬编码签名 */
  extraHeaders?: Record<string, string>
  audit?: XhsRequestAuditContext
  parseEnvelope?: boolean
  apiKey?: string
  /** 默认 20 秒，避免 POST 永远 pending */
  timeoutMs?: number
  /** 若提供，用此函数解析响应文本（福袋超长 ID 需保字串精度） */
  parseResponseText?: <T>(text: string) => T
  /** 捕获原始响应文本（用于超长 ID 校验，勿记录地址/手机号） */
  captureResponseText?: (text: string) => void
  signLogContext?: {
    tag?: 'quality-badcase-sign' | 'xhs-sign'
    accountName?: string
    liveAccountId?: string
  }
  /** 仅真正发起 HTTP 请求时输出 CMD 业务日志（不含本地签名探测） */
  cmdLog?: {
    accountName: string
    liveAccountId?: string
    accountIndex?: number
    accountTotal?: number
    apiLabel: string
    pageNo?: number
    dateRange?: string
  }
}

export const XHS_HTTP_TIMEOUT_MS = 20_000

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('接口请求超时（20秒）')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function auditUrlParts(url: string): { urlHost: string; urlPath: string } {
  try {
    const u = new URL(url)
    return { urlHost: u.host, urlPath: u.pathname }
  } catch {
    return { urlHost: 'unknown', urlPath: url.slice(0, 120) }
  }
}

async function logSignedRequest(
  ok: boolean,
  opts: RequestXhsJsonOptions,
  meta: Record<string, unknown>,
  errorMessage?: string,
): Promise<void> {
  const audit = opts.audit
  if (!audit?.userId) return
  const action: AuditAction = ok ? 'xhs_signed_request_success' : 'xhs_signed_request_failed'
  const { urlPath } = auditUrlParts(opts.url)
  await writeOperationLog({
    userId: audit.userId,
    username: audit.username ?? null,
    role: audit.role ?? null,
    action,
    module: (audit.module as 'xhs_export') ?? 'xhs_export',
    description: ok
      ? `小红书签名请求成功 ${opts.method} ${urlPath}`
      : `小红书签名请求失败：${errorMessage ?? '未知'}`,
    requestId: audit.requestId ?? null,
    ip: audit.ip ?? null,
    userAgent: audit.userAgent ?? null,
    meta: {
      urlPath,
      method: opts.method,
      hasXS: Boolean(meta.hasXS),
      hasAuthorization: Boolean(meta.hasAuthorization),
      errorMessage: errorMessage ? String(errorMessage).slice(0, 300) : null,
    },
  })
}

export async function requestXhsJson<T>(options: RequestXhsJsonOptions): Promise<T> {
  const needSign = options.needSign !== false
  const referer = options.referer ?? 'https://ark.xiaohongshu.com/'
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: 'https://ark.xiaohongshu.com',
    Referer: referer,
    'User-Agent': XHS_BROWSER_UA,
    Cookie: options.cookie,
    ...(options.extraHeaders ?? {}),
  }
  // 禁止调用方硬编码平台签名
  delete headers['x-s']
  delete headers['x-t']
  delete headers['x-s-common']
  delete headers['X-S']
  delete headers['X-T']
  delete headers['X-S-Common']

  let signMeta = {
    hasAuthorization: false,
    hasXS: false,
    hasXT: false,
    hasXSCommon: false,
  }

  try {
    if (needSign) {
      const bodyObj =
        options.method === 'POST' && options.body != null && typeof options.body === 'object'
          ? (options.body as Record<string, unknown>)
          : null
      const signed = await signXhsRequest({
        method: options.method,
        url: options.url,
        body: bodyObj,
        cookie: options.cookie,
        logContext: options.signLogContext,
      })
      headers.Authorization = signed.authorization
      headers['x-s'] = signed['x-s']
      headers['x-t'] = signed['x-t']
      headers['x-s-common'] = signed['x-s-common']
      signMeta = {
        hasAuthorization: Boolean(signed.authorization),
        hasXS: Boolean(signed['x-s']),
        hasXT: Boolean(signed['x-t']),
        hasXSCommon: Boolean(signed['x-s-common']),
      }
      if (options.audit?.downloadTaskId) {
        await patchDownloadPipeline(options.audit.downloadTaskId, {
          signSuccess: true,
        })
      }
    }

    const init: RequestInit = {
      method: options.method,
      headers,
    }
    if (options.method === 'POST' && options.body !== undefined) {
      init.body = JSON.stringify(options.body)
    }

    const timeoutMs = options.timeoutMs ?? XHS_HTTP_TIMEOUT_MS

    if (options.cmdLog) {
      const { logXhsApiQueryStart } = await import('../utils/sync-cmd-log')
      logXhsApiQueryStart({
        apiLabel: options.cmdLog.apiLabel,
        accountName: options.cmdLog.accountName,
        pageNo: options.cmdLog.pageNo,
        dateRange: options.cmdLog.dateRange,
      })
    }

    const res = await fetchWithTimeout(options.url, init, timeoutMs)
    const text = await res.text()
    options.captureResponseText?.(text)

    if (!res.ok) {
      const authCheck = isXhsAuthExpired({ httpStatus: res.status, bodyText: text })
      const errMsg = authCheck.expired || authCheck.suspected
        ? authCheck.errorMessage ?? formatXhsApiError(res.status, text)
        : formatXhsApiError(res.status, text)
      if (shouldStopSyncForHttpStatus(res.status)) {
        logXhsSyncRoundStopped()
      }
      if (options.audit?.downloadTaskId) {
        await patchDownloadPipeline(options.audit.downloadTaskId, {
          apiSuccess: false,
          failedPhase: 'api',
        })
        await updateTaskApiDebug(options.audit.downloadTaskId, {
          live: {
            httpStatus: res.status,
            apiOk: false,
            failedPhase: 'api',
          },
        })
      }
      await logSignedRequest(false, options, signMeta, errMsg)
      if (authCheck.expired || authCheck.suspected) {
        throw new XhsAuthError({
          message: errMsg,
          kind: authCheck.errorCode ?? 'auth_expired',
          apiKey: options.apiKey,
          cookieStatus: authCheck.cookieStatus ?? 'invalid',
          stopRound: shouldStopSyncForHttpStatus(res.status),
          httpStatus: res.status,
        })
      }
      throw new Error(errMsg)
    }

    try {
      const json = (
        options.parseResponseText
          ? options.parseResponseText<T>(text)
          : (JSON.parse(text) as T)
      ) as T & { code?: number; success?: boolean; msg?: string }
      if (options.parseEnvelope !== false) {
        const envelope = json as { code?: number; success?: boolean; msg?: string }
        if (envelope.code !== undefined && envelope.code !== 0 && envelope.success === false) {
          const msg = envelope.msg || '小红书接口返回失败'
          const authCheck = isXhsAuthExpired({
            httpStatus: res.status,
            bodyText: text,
            envelope,
          })
          if (authCheck.expired || authCheck.suspected) {
            const errMsg = authCheck.errorMessage ?? msg
            if (shouldStopSyncForHttpStatus(res.status)) {
              logXhsSyncRoundStopped()
            }
            await logSignedRequest(false, options, signMeta, errMsg)
            throw new XhsAuthError({
              message: errMsg,
              kind: authCheck.errorCode ?? 'auth_expired',
              apiKey: options.apiKey,
              cookieStatus: authCheck.cookieStatus ?? 'invalid',
              stopRound: shouldStopSyncForHttpStatus(res.status),
            })
          }
          if (isXhsSignRelatedMessage(msg) || isXhsSignRelatedMessage(text)) {
            const errMsg = formatXhsApiError(res.status, text)
            await logSignedRequest(false, options, signMeta, errMsg)
            throw new Error(errMsg)
          }
          await logSignedRequest(false, options, signMeta, msg)
          throw new Error(msg)
        }
      }
      if (options.audit?.downloadTaskId) {
        const envelope = json as { code?: number; success?: boolean; msg?: string }
        await patchDownloadPipeline(options.audit.downloadTaskId, { apiSuccess: true })
        await updateTaskApiDebug(options.audit.downloadTaskId, {
          live: {
            httpStatus: res.status,
            xhsCode: envelope.code,
            xhsSuccess: envelope.success,
            xhsMsg: envelope.msg ?? undefined,
            apiOk: true,
            signOk: signMeta.hasXS,
          },
        })
      }
      await logSignedRequest(true, options, { hasXS: signMeta.hasXS, hasAuthorization: signMeta.hasAuthorization })
      return json
    } catch (parseErr) {
      if (parseErr instanceof Error && parseErr.message !== '小红书接口返回格式异常') {
        throw parseErr
      }
      const errMsg = isXhsSignRelatedMessage(text)
        ? formatXhsApiError(res.status, text)
        : '小红书接口返回格式异常'
      await logSignedRequest(false, options, signMeta, errMsg)
      throw new Error(errMsg)
    }
  } catch (err) {
    const taskId = options.audit?.downloadTaskId
    if (taskId && needSign && !signMeta.hasXS) {
      await patchDownloadPipeline(taskId, {
        signSuccess: false,
        failedPhase: 'sign',
      })
      await updateTaskApiDebug(taskId, {
        live: { signOk: false, failedPhase: 'sign' },
      })
    } else if (taskId && signMeta.hasXS) {
      await patchDownloadPipeline(taskId, {
        apiSuccess: false,
        failedPhase: 'api',
      })
      await updateTaskApiDebug(taskId, {
        live: { signOk: true, failedPhase: 'api' },
      })
    }
    if (err instanceof XhsAuthError) {
      throw err
    }
    if (err instanceof Error && isXhsSignRelatedMessage(err.message)) {
      throw new Error(formatXhsSignBridgeError(err.message))
    }
    if (err instanceof Error) {
      await logSignedRequest(false, options, signMeta, err.message)
      throw err
    }
    throw new Error('小红书接口请求失败')
  }
}
