/**
 * 品退 / 商品问题接口签名自检（单账号）
 */
import {
  getResolvedSignScriptPath,
  getSignPythonCandidates,
  getLastSuccessfulPythonCommand,
  inspectCookieForSigning,
  runQualityBadcaseSignTest,
  type SignRunDiagnostics,
} from './xhs-sign.service'
import {
  QUALITY_BAD_CASE_API,
  QUALITY_BAD_CASE_REFERER,
  QUALITY_SUMMARY_TIME_WINDOW_CODE,
} from './quality-badcase.types'
import { requestXhsJson } from './xhs-http.service'

export interface QualityBadcaseSignCheckResult {
  accountName: string
  liveAccountId: string
  hasA1: boolean
  hasWebSession: boolean
  hasAccessTokenArk: boolean
  cookieLength: number
  pythonCommand: string | null
  scriptPath: string | null
  scriptExists: boolean
  signOk: boolean
  qualityApiOk: boolean
  errorReason: string | null
  signError: string | null
  qualityApiError: string | null
  diagnostics: SignRunDiagnostics | null
}

export async function probeQualityBadcaseSignForAccount(params: {
  accountName: string
  liveAccountId: string
  cookie: string
}): Promise<QualityBadcaseSignCheckResult> {
  const inspect = inspectCookieForSigning(params.cookie)
  const script = getResolvedSignScriptPath()
  const base = {
    accountName: params.accountName,
    liveAccountId: params.liveAccountId,
    hasA1: inspect.hasA1,
    hasWebSession: inspect.hasWebSession,
    hasAccessTokenArk: inspect.hasAccessTokenArk,
    cookieLength: inspect.cookieLength,
    scriptPath: script.path,
    scriptExists: script.exists,
    qualityApiOk: false,
    qualityApiError: null as string | null,
    diagnostics: null as SignRunDiagnostics | null,
  }

  if (!params.cookie.trim()) {
    return {
      ...base,
      pythonCommand: null,
      signOk: false,
      errorReason: 'no_cookie',
      signError: '尚未配置 Cookie',
    }
  }

  if (!inspect.hasA1) {
    return {
      ...base,
      pythonCommand: getSignPythonCandidates()[0] ?? null,
      signOk: false,
      errorReason: 'cookie_missing_a1',
      signError: 'Cookie 缺少 a1，请重新复制完整 Cookie',
    }
  }

  if (!inspect.hasAccessTokenArk) {
    return {
      ...base,
      pythonCommand: getSignPythonCandidates()[0] ?? null,
      signOk: false,
      errorReason: 'cookie_missing_access_token',
      signError:
        '当前 Cookie 可用于部分普通接口，但缺少签名接口所需 access-token-ark，请重新复制完整 Cookie',
    }
  }

  if (!script.exists) {
    return {
      ...base,
      pythonCommand: getSignPythonCandidates()[0] ?? null,
      signOk: false,
      errorReason: 'script_not_found',
      signError: `签名脚本不存在，已尝试: ${script.tried.join(' | ')}`,
    }
  }

  const signTest = await runQualityBadcaseSignTest({
    cookie: params.cookie,
    accountName: params.accountName,
    liveAccountId: params.liveAccountId,
  })

  if (!signTest.ok) {
    return {
      ...base,
      pythonCommand: signTest.diagnostics?.pythonCommand ?? null,
      signOk: false,
      errorReason: signTest.reason ?? 'sign_generation_failed',
      signError: signTest.message,
      diagnostics: signTest.diagnostics,
    }
  }

  let qualityApiOk = false
  let qualityApiError: string | null = null
  try {
    await requestXhsJson<unknown>({
      method: 'POST',
      url: QUALITY_BAD_CASE_API.summaryList,
      body: {
        pageNo: 1,
        pageSize: 1,
        negativePayPkgCntAsc: 0,
        rectifySearch: 0,
        controlFlowSearch: 0,
        timeWindowCode: QUALITY_SUMMARY_TIME_WINDOW_CODE,
      },
      cookie: params.cookie,
      referer: QUALITY_BAD_CASE_REFERER,
      needSign: true,
      signLogContext: {
        tag: 'quality-badcase-sign',
        accountName: params.accountName,
        liveAccountId: params.liveAccountId,
      },
    })
    qualityApiOk = true
  } catch (e) {
    qualityApiError = e instanceof Error ? e.message : String(e)
  }

  return {
    ...base,
    pythonCommand:
      signTest.diagnostics?.pythonCommand ??
      getLastSuccessfulPythonCommand() ??
      getSignPythonCandidates()[0] ??
      null,
    signOk: true,
    qualityApiOk,
    errorReason: qualityApiOk ? null : 'quality_api_failed',
    signError: null,
    qualityApiError,
    diagnostics: signTest.diagnostics,
  }
}
