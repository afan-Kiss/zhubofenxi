import { getCredentialPublic, getDecryptedCookie } from './credential.service'
import { getSetting, setSetting } from './system-setting.service'
import { inspectCookieForSigning, probeXhsSigner } from './xhs-sign.service'

const LAST_TEST_AT_KEY = 'xhsSignLastTestAt'
const LAST_TEST_OK_KEY = 'xhsSignLastTestOk'
const LAST_SIGN_ERROR_KEY = 'xhsSignLastError'

export interface XhsSignStatusView {
  hasCookie: boolean
  hasA1: boolean
  hasAccessTokenArk: boolean
  canExtractAuthorization: boolean
  signerEnabled: boolean
  pythonAvailable: boolean
  scriptExists: boolean
  xhshowInstalled: boolean
  signerModuleOk: boolean
  lastSignTestAt: string | null
  lastSignTestOk: boolean | null
  lastSignError: string | null
  message: string | null
}

export async function getXhsSignStatus(platformName = 'xiaohongshu'): Promise<XhsSignStatusView> {
  const cred = await getCredentialPublic(platformName)
  let inspect = { hasA1: false, hasAccessTokenArk: false, canExtractAuthorization: false }

  if (cred.hasCookie) {
    try {
      const cookie = await getDecryptedCookie(platformName)
      inspect = inspectCookieForSigning(cookie)
    } catch {
      inspect = { hasA1: false, hasAccessTokenArk: false, canExtractAuthorization: false }
    }
  }

  const probe = await probeXhsSigner()
  const lastSignTestAt = await getSetting(LAST_TEST_AT_KEY)
  const lastSignTestOkRaw = await getSetting(LAST_TEST_OK_KEY)
  const lastSignError = await getSetting(LAST_SIGN_ERROR_KEY)

  const signerModuleOk =
    probe.enabled &&
    probe.scriptExists &&
    probe.pythonAvailable &&
    probe.xhshowInstalled &&
    !probe.message?.includes('pip install')

  return {
    hasCookie: cred.hasCookie,
    hasA1: inspect.hasA1,
    hasAccessTokenArk: inspect.hasAccessTokenArk,
    canExtractAuthorization: inspect.canExtractAuthorization,
    signerEnabled: probe.enabled,
    pythonAvailable: probe.pythonAvailable,
    scriptExists: probe.scriptExists,
    xhshowInstalled: probe.xhshowInstalled,
    signerModuleOk,
    lastSignTestAt,
    lastSignTestOk: lastSignTestOkRaw == null ? null : lastSignTestOkRaw === 'true',
    lastSignError,
    message: probe.message,
  }
}

export async function recordSignTestResult(ok: boolean, errorMessage: string | null): Promise<void> {
  await setSetting(LAST_TEST_AT_KEY, new Date().toISOString())
  await setSetting(LAST_TEST_OK_KEY, String(ok))
  if (errorMessage) {
    await setSetting(LAST_SIGN_ERROR_KEY, errorMessage.slice(0, 500))
  } else {
    await setSetting(LAST_SIGN_ERROR_KEY, '')
  }
}
