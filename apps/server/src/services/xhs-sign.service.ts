import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, SERVER_ROOT } from '../config/env'
import {
  isVerboseErrorEnabled,
  isXhsSignDebugEnabled,
  logInfo,
  logWarn,
} from '../utils/server-log'
import {
  QUALITY_BAD_CASE_API,
  QUALITY_BAD_CASE_REFERER,
  QUALITY_SUMMARY_TIME_WINDOW_CODE,
} from './quality-badcase.types'

loadEnv()

export interface XhsSignedHeaders {
  'x-s': string
  'x-t': string
  'x-s-common': string
  authorization: string
}

export type SignTestFailureReason =
  | 'python_unavailable'
  | 'python_module_missing'
  | 'script_not_found'
  | 'xhshow_not_installed'
  | 'signer_disabled'
  | 'cookie_missing_a1'
  | 'cookie_missing_web_session'
  | 'cookie_missing_access_token'
  | 'authorization_extract_failed'
  | 'sign_generation_failed'
  | 'sign_fields_empty'

export interface SignLogContext {
  tag?: 'quality-badcase-sign' | 'xhs-sign'
  accountName?: string
  liveAccountId?: string
}

export interface SignRunDiagnostics {
  accountName?: string
  liveAccountId?: string
  pythonCommand: string
  scriptPath: string
  cwd: string
  nodeEnv: string
  scriptExists: boolean
  scriptTried: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  hasXS: boolean
  hasXT: boolean
  hasXSCommon: boolean
  hasAuthorization: boolean
  hasA1: boolean
  hasWebSession: boolean
  hasAccessTokenArk: boolean
  cookieLength: number
  failureReason: SignTestFailureReason | null
}

const SIGN_TEST_MESSAGES: Record<SignTestFailureReason, string> = {
  python_unavailable: '未找到可用 Python，请安装 Python 或设置 XHS_SIGN_PYTHON',
  python_module_missing:
    'Python 缺少 xhshow 等依赖，请执行：pip install -r apps/server/tools/xhs_signer/requirements.txt',
  script_not_found: '小红书签名脚本不存在，请检查 XHS_SIGNER_SCRIPT 或 tools/xhs_signer/signer.py',
  xhshow_not_installed:
    'xhshow 未安装，请执行：pip install -r apps/server/tools/xhs_signer/requirements.txt',
  signer_disabled: '签名功能已禁用（XHS_SIGNER_ENABLED=false）',
  cookie_missing_a1: 'Cookie 缺少 a1，请从已登录的小红书商家后台重新复制完整 Cookie',
  cookie_missing_web_session:
    'Cookie 缺少 web_session；普通接口可能可用，但品退签名接口需要完整 Cookie',
  cookie_missing_access_token:
    'Cookie 缺少 access-token-ark.xiaohongshu.com；普通接口可能可用，但品退签名需要该字段',
  authorization_extract_failed:
    'Authorization 提取失败，请确认 access-token 值为 customer.ark.AT-xxx 格式',
  sign_generation_failed: '签名生成失败',
  sign_fields_empty: '签名返回字段为空（x-s / x-t / x-s-common）',
}

export interface XhsSignProbeResult {
  pythonAvailable: boolean
  scriptExists: boolean
  xhshowInstalled: boolean
  enabled: boolean
  pythonPath: string
  scriptPath: string
  message: string | null
}

const TEST_SIGN_URL =
  'https://ark.xiaohongshu.com/api/edith/fulfillment/tool/file/start_export'

export function isSignerEnabled(): boolean {
  const raw = process.env.XHS_SIGNER_ENABLED ?? 'true'
  return raw !== 'false' && raw !== '0'
}

export function getSignPythonCandidates(): string[] {
  const fromEnv = [
    process.env.XHS_SIGN_PYTHON?.trim(),
    process.env.XHS_SIGNER_PYTHON?.trim(),
  ].filter(Boolean) as string[]
  const defaults = ['py', 'python', 'python3']
  const seen = new Set<string>()
  const out: string[] = []
  for (const cmd of [...fromEnv, ...defaults]) {
    const normalized = normalizePythonCommand(cmd)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      out.push(normalized)
    }
  }
  return out
}

function normalizePythonCommand(cmd: string): string {
  if (path.isAbsolute(cmd)) return cmd
  if (cmd.includes('/') || cmd.includes('\\') || cmd.toLowerCase().endsWith('.exe')) {
    return path.resolve(SERVER_ROOT, cmd)
  }
  return cmd
}

function resolveSignScriptCandidates(): string[] {
  const candidates: string[] = []
  const raw = process.env.XHS_SIGNER_SCRIPT?.trim()
  if (raw) {
    candidates.push(path.isAbsolute(raw) ? raw : path.resolve(SERVER_ROOT, raw))
  }
  candidates.push(path.join(SERVER_ROOT, 'tools/xhs_signer/signer.py'))
  candidates.push(path.join(process.cwd(), 'apps/server/tools/xhs_signer/signer.py'))
  candidates.push(path.join(process.cwd(), 'tools/xhs_signer/signer.py'))
  return [...new Set(candidates)]
}

export function getResolvedSignScriptPath(): {
  path: string
  exists: boolean
  tried: string[]
} {
  const tried = resolveSignScriptCandidates()
  for (const p of tried) {
    if (fs.existsSync(p)) return { path: p, exists: true, tried }
  }
  return { path: tried[0] ?? path.join(SERVER_ROOT, 'tools/xhs_signer/signer.py'), exists: false, tried }
}

/** @deprecated 使用 getResolvedSignScriptPath */
function resolveScriptPath(): string {
  return getResolvedSignScriptPath().path
}

/** @deprecated 使用 getSignPythonCandidates()[0] */
function resolvePythonPath(): string {
  return getSignPythonCandidates()[0] ?? 'python'
}

export function getXhsSignerPaths(): { pythonPath: string; scriptPath: string; enabled: boolean } {
  const script = getResolvedSignScriptPath()
  return {
    pythonPath: resolvePythonPath(),
    scriptPath: script.path,
    enabled: isSignerEnabled(),
  }
}

export function inspectCookieForSigning(cookie: string): {
  hasA1: boolean
  hasWebSession: boolean
  hasAccessTokenArk: boolean
  canExtractAuthorization: boolean
  cookieLength: number
} {
  const parts = cookie.split(';').map((p) => p.trim())
  let hasA1 = false
  let hasWebSession = false
  let hasAccessTokenArk = false
  let tokenValue = ''
  for (const part of parts) {
    if (!part.includes('=')) continue
    const eq = part.indexOf('=')
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 'a1' && v) hasA1 = true
    if ((k === 'web_session' || k === 'webSession') && v) hasWebSession = true
    if ((k === 'access-token-ark.xiaohongshu.com' || k === 'access-token-ark') && v) {
      hasAccessTokenArk = true
      tokenValue = v
    }
  }
  let auth = tokenValue
  if (auth.startsWith('customer.ark.')) auth = auth.slice('customer.ark.'.length)
  return {
    hasA1,
    hasWebSession,
    hasAccessTokenArk,
    canExtractAuthorization: hasAccessTokenArk && auth.startsWith('AT-'),
    cookieLength: cookie.length,
  }
}

let lastSignDiagnostics: SignRunDiagnostics | null = null
let lastSuccessfulPythonCommand: string | null = null

export function getLastSignDiagnostics(): SignRunDiagnostics | null {
  return lastSignDiagnostics
}

export function getLastSuccessfulPythonCommand(): string | null {
  return lastSuccessfulPythonCommand
}

function logPrefix(ctx?: SignLogContext): string {
  return ctx?.tag === 'quality-badcase-sign' ? '[quality-badcase-sign]' : '[xhs-sign]'
}

function signLogScope(ctx?: SignLogContext): string {
  return ctx?.tag === 'quality-badcase-sign' ? '品退同步' : '签名'
}

function logSignDiagnostics(
  level: 'info' | 'warn',
  message: string,
  ctx?: SignLogContext,
  extra?: Record<string, unknown>,
): void {
  if (level === 'info' && !isXhsSignDebugEnabled()) return

  const scope = '本地签名'
  const accountPrefix =
    ctx?.accountName != null ? `账号=${ctx.accountName} ` : ''
  let text = `${accountPrefix}${message}`
  if (extra && Object.keys(extra).length > 0 && isXhsSignDebugEnabled()) {
    const detail = Object.entries(extra)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' ')
    text = `${text} ${detail}`
  }
  if (level === 'warn') logWarn(scope, text)
  else logInfo(scope, text)
}

function isPythonSpawnError(stderr: string, stdout: string, spawnErr?: string): boolean {
  const text = `${spawnErr ?? ''} ${stderr} ${stdout}`.toLowerCase()
  return (
    text.includes('enoent') ||
    text.includes('not found') ||
    text.includes('系统找不到指定的文件') ||
    text.includes('is not recognized as an internal or external command')
  )
}

function isPythonModuleError(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('no module named') ||
    lower.includes('modulenotfounderror') ||
    lower.includes('xhshow') ||
    lower.includes('pip install')
  )
}

function classifySignFailure(
  stderr: string,
  stdout: string,
  exitCode: number | null,
  spawnErr?: string,
): SignTestFailureReason {
  const text = `${stderr}\n${stdout}\n${spawnErr ?? ''}`
  if (isPythonSpawnError(stderr, stdout, spawnErr)) return 'python_unavailable'
  if (isPythonModuleError(text)) return 'python_module_missing'
  if (text.includes('缺少 a1')) return 'cookie_missing_a1'
  if (text.includes('access-token-ark')) return 'cookie_missing_access_token'
  if (exitCode !== 0 && !stdout.trim()) return 'sign_generation_failed'
  return 'sign_generation_failed'
}

interface SpawnSignAttempt {
  ok: boolean
  headers?: XhsSignedHeaders
  stdout: string
  stderr: string
  exitCode: number | null
  spawnError?: string
  parsedMessage?: string
  failureReason?: SignTestFailureReason
}

function jsonStringifySafe(value: unknown): string {
  const json = JSON.stringify(value)
  return json.replace(/[\uD800-\uDFFF]/g, '\uFFFD')
}

function spawnSignerOnce(
  pythonPath: string,
  scriptPath: string,
  input: Record<string, unknown>,
): Promise<SpawnSignAttempt> {
  return new Promise((resolve) => {
    const child = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: path.dirname(scriptPath),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (err) => {
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        spawnError: err.message,
        failureReason: classifySignFailure(stderr, stdout, null, err.message),
      })
    })

    child.on('close', (code) => {
      const text = stdout.trim() || stderr.trim()
      try {
        const parsed = JSON.parse(text || '{}') as {
          ok?: boolean
          headers?: XhsSignedHeaders
          message?: string
        }
        if (parsed.ok && parsed.headers) {
          const h = parsed.headers
          if (!h['x-s'] || !h['x-t'] || !h['x-s-common']) {
            resolve({
              ok: false,
              stdout,
              stderr,
              exitCode: code,
              parsedMessage: parsed.message,
              failureReason: 'sign_fields_empty',
            })
            return
          }
          if (!h.authorization?.startsWith('AT-')) {
            resolve({
              ok: false,
              stdout,
              stderr,
              exitCode: code,
              parsedMessage: parsed.message,
              failureReason: 'authorization_extract_failed',
            })
            return
          }
          resolve({ ok: true, headers: h, stdout, stderr, exitCode: code })
          return
        }
        resolve({
          ok: false,
          stdout,
          stderr,
          exitCode: code,
          parsedMessage: parsed.message ?? '小红书请求签名失败',
          failureReason: classifySignFailure(stderr, stdout, code),
        })
      } catch {
        resolve({
          ok: false,
          stdout,
          stderr,
          exitCode: code,
          failureReason: classifySignFailure(stderr, stdout, code),
        })
      }
    })

    child.stdin.write(jsonStringifySafe(input), 'utf8')
    child.stdin.end()
  })
}

function buildDiagnostics(
  attempt: SpawnSignAttempt,
  pythonCommand: string,
  script: { path: string; exists: boolean; tried: string[] },
  cookie: string,
  ctx?: SignLogContext,
): SignRunDiagnostics {
  const inspect = inspectCookieForSigning(cookie)
  const headers = attempt.headers
  return {
    accountName: ctx?.accountName,
    liveAccountId: ctx?.liveAccountId,
    pythonCommand,
    scriptPath: script.path,
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    scriptExists: script.exists,
    scriptTried: script.tried,
    stdout: attempt.stdout,
    stderr: attempt.stderr,
    exitCode: attempt.exitCode,
    hasXS: Boolean(headers?.['x-s']),
    hasXT: Boolean(headers?.['x-t']),
    hasXSCommon: Boolean(headers?.['x-s-common']),
    hasAuthorization: Boolean(headers?.authorization?.startsWith('AT-')),
    hasA1: inspect.hasA1,
    hasWebSession: inspect.hasWebSession,
    hasAccessTokenArk: inspect.hasAccessTokenArk,
    cookieLength: inspect.cookieLength,
    failureReason: attempt.failureReason ?? null,
  }
}

function formatSignFailureMessage(reason: SignTestFailureReason, detail?: string): string {
  const base = SIGN_TEST_MESSAGES[reason] ?? SIGN_TEST_MESSAGES.sign_generation_failed
  if (!detail?.trim()) return base
  if (base.includes(detail.trim())) return base
  return `${base}（${detail.trim().slice(0, 240)}）`
}

function logSignFailure(
  attempt: SpawnSignAttempt,
  pythonCommand: string,
  script: { path: string; exists: boolean; tried: string[] },
  cookie: string,
  ctx?: SignLogContext,
): SignRunDiagnostics {
  const diagnostics = buildDiagnostics(attempt, pythonCommand, script, cookie, ctx)
  const reason = attempt.failureReason ?? 'sign_generation_failed'
  const scope = '本地签名'
  const accountPrefix =
    ctx?.accountName != null ? `账号=${ctx.accountName} ` : ''
  const human = formatSignFailureMessage(
    reason,
    attempt.parsedMessage ?? (attempt.stderr.trim() || attempt.spawnError),
  )
  const impact =
    ctx?.tag === 'quality-badcase-sign'
      ? '本次品退同步跳过，订单/售后普通接口不受影响。详情请开启 ENABLE_XHS_SIGN_DEBUG=true。'
      : '订单/售后普通接口可能仍可用。详情请开启 ENABLE_XHS_SIGN_DEBUG=true。'
  logWarn(scope, `${accountPrefix}签名失败：${human}。${impact}`)

  if (isXhsSignDebugEnabled() || isVerboseErrorEnabled()) {
    logSignDiagnostics(
      'warn',
      `诊断 python=${pythonCommand} script=${script.path}`,
      ctx,
      {
        hasA1: diagnostics.hasA1,
        hasWebSession: diagnostics.hasWebSession,
        hasAccessTokenArk: diagnostics.hasAccessTokenArk,
        cookieLength: diagnostics.cookieLength,
      },
    )
    if (attempt.stderr.trim()) {
      logSignDiagnostics('warn', `stderr=${attempt.stderr.trim().slice(0, 800)}`, ctx)
    }
    if (attempt.stdout.trim() && !attempt.ok) {
      logSignDiagnostics('warn', `stdout=${attempt.stdout.trim().slice(0, 400)}`, ctx)
    }
  }
  lastSignDiagnostics = diagnostics
  return diagnostics
}

async function runSignerProcess(
  input: Record<string, unknown>,
  opts?: { cookie?: string; logContext?: SignLogContext },
): Promise<XhsSignedHeaders> {
  if (!isSignerEnabled()) {
    throw new Error(SIGN_TEST_MESSAGES.signer_disabled)
  }

  const script = getResolvedSignScriptPath()
  const cookie = opts?.cookie ?? String(input.cookie ?? '')

  if (!script.exists) {
    if (isXhsSignDebugEnabled()) {
      logSignDiagnostics(
        'warn',
        `签名脚本未找到 tried=${script.tried.join(' | ')}`,
        opts?.logContext,
      )
    } else {
      logWarn('本地签名', '签名脚本未找到，请检查 xhshow 安装')
    }
    throw new Error(
      formatSignFailureMessage(
        'script_not_found',
        isXhsSignDebugEnabled() ? script.tried.join(' | ') : undefined,
      ),
    )
  }

  const pythonCandidates = getSignPythonCandidates()
  let lastAttempt: SpawnSignAttempt | null = null
  let lastPython = pythonCandidates[0] ?? 'python'

  for (const pythonPath of pythonCandidates) {
    lastPython = pythonPath
    const attempt = await spawnSignerOnce(pythonPath, script.path, input)
    if (attempt.ok && attempt.headers) {
      if (isXhsSignDebugEnabled()) {
        logInfo('本地签名', '已生成请求签名')
      }
      lastSuccessfulPythonCommand = pythonPath
      return attempt.headers
    }
    lastAttempt = attempt
    if (attempt.failureReason === 'python_unavailable') {
      if (isXhsSignDebugEnabled()) {
        logSignDiagnostics('info', `python=${pythonPath} 不可用，尝试下一个`, opts?.logContext)
      }
      continue
    }
    if (attempt.failureReason === 'python_module_missing') {
      logSignFailure(attempt, pythonPath, script, cookie, opts?.logContext)
      throw new Error(
        formatSignFailureMessage(
          'python_module_missing',
          attempt.stderr.trim() || attempt.parsedMessage,
        ),
      )
    }
    break
  }

  if (!lastAttempt) {
    throw new Error(SIGN_TEST_MESSAGES.python_unavailable)
  }

  logSignFailure(lastAttempt, lastPython, script, cookie, opts?.logContext)
  const reason = lastAttempt.failureReason ?? 'sign_generation_failed'
  const detail =
    lastAttempt.parsedMessage ??
    lastAttempt.stderr.trim() ??
    lastAttempt.spawnError ??
    lastAttempt.stdout.trim()
  throw new Error(formatSignFailureMessage(reason, detail))
}

export async function signXhsRequest(params: {
  method: 'GET' | 'POST'
  url: string
  body?: Record<string, unknown> | null
  cookie: string
  xsecAppid?: string
  logContext?: SignLogContext
}): Promise<XhsSignedHeaders> {
  return runSignerProcess(
    {
      method: params.method,
      url: params.url,
      body: params.body ?? null,
      cookie: params.cookie,
      xsec_appid: params.xsecAppid ?? 'seller',
    },
    { cookie: params.cookie, logContext: params.logContext },
  )
}

export async function runQualityBadcaseSignTest(params: {
  cookie: string
  accountName?: string
  liveAccountId?: string
}): Promise<{
  ok: boolean
  message: string
  reason?: SignTestFailureReason
  diagnostics: SignRunDiagnostics | null
}> {
  const logContext: SignLogContext = {
    tag: 'quality-badcase-sign',
    accountName: params.accountName,
    liveAccountId: params.liveAccountId,
  }
  const inspect = inspectCookieForSigning(params.cookie)
  if (!inspect.hasA1) {
    return {
      ok: false,
      message: SIGN_TEST_MESSAGES.cookie_missing_a1,
      reason: 'cookie_missing_a1',
      diagnostics: null,
    }
  }
  if (!inspect.hasAccessTokenArk) {
    return {
      ok: false,
      message: SIGN_TEST_MESSAGES.cookie_missing_access_token,
      reason: 'cookie_missing_access_token',
      diagnostics: null,
    }
  }

  const script = getResolvedSignScriptPath()
  if (!script.exists) {
    return {
      ok: false,
      message: formatSignFailureMessage('script_not_found', script.tried.join(' | ')),
      reason: 'script_not_found',
      diagnostics: null,
    }
  }

  try {
    await signXhsRequest({
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
      logContext,
    })
    return { ok: true, message: '品退签名生成成功', diagnostics: getLastSignDiagnostics() }
  } catch (err) {
    const message = err instanceof Error ? err.message : SIGN_TEST_MESSAGES.sign_generation_failed
    let reason: SignTestFailureReason = 'sign_generation_failed'
    for (const [k, v] of Object.entries(SIGN_TEST_MESSAGES) as Array<
      [SignTestFailureReason, string]
    >) {
      if (message.includes(v.slice(0, 20)) || message === v) {
        reason = k
        break
      }
    }
    if (message.includes('未找到可用 Python')) reason = 'python_unavailable'
    if (message.includes('xhshow') || message.includes('依赖')) reason = 'python_module_missing'
    if (message.includes('脚本不存在')) reason = 'script_not_found'
    return {
      ok: false,
      message,
      reason,
      diagnostics: getLastSignDiagnostics(),
    }
  }
}

export async function probeXhsSigner(): Promise<XhsSignProbeResult> {
  const { scriptPath, enabled } = getXhsSignerPaths()
  const script = getResolvedSignScriptPath()
  const pythonPath = resolvePythonPath()
  if (!enabled) {
    return {
      pythonAvailable: false,
      scriptExists: script.exists,
      xhshowInstalled: false,
      enabled: false,
      pythonPath,
      scriptPath,
      message: SIGN_TEST_MESSAGES.signer_disabled,
    }
  }

  if (!script.exists) {
    return {
      pythonAvailable: false,
      scriptExists: false,
      xhshowInstalled: false,
      enabled: true,
      pythonPath,
      scriptPath,
      message: `签名脚本文件不存在（${script.tried.join(' | ')}）`,
    }
  }

  try {
    await runSignerProcess({
      method: 'POST',
      url: TEST_SIGN_URL,
      body: { data_condition: '{}', source_data_bean: 'OrderQueryPackageFileBuilder' },
      cookie:
        'a1=probe12345678901234567890123456789012; web_session=probe; access-token-ark.xiaohongshu.com=customer.ark.AT-probe',
      xsec_appid: 'seller',
    })
    return {
      pythonAvailable: true,
      scriptExists: true,
      xhshowInstalled: true,
      enabled: true,
      pythonPath,
      scriptPath,
      message: null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '签名探测失败'
    const reason =
      msg.includes('未找到可用 Python') || msg.includes('python_unavailable')
        ? 'python_unavailable'
        : msg.includes('xhshow') || msg.includes('依赖')
          ? 'xhshow_not_installed'
          : 'sign_generation_failed'
    return {
      pythonAvailable: reason !== 'python_unavailable',
      scriptExists: script.exists,
      xhshowInstalled: reason !== 'xhshow_not_installed',
      enabled: true,
      pythonPath,
      scriptPath,
      message: msg,
    }
  }
}

export async function testSignWithCookie(cookie: string): Promise<{
  ok: boolean
  hasXS: boolean
  hasXT: boolean
  hasXSCommon: boolean
  hasAuthorization: boolean
  hasA1: boolean
  hasWebSession: boolean
  message: string
  reason?: SignTestFailureReason
  qualitySignOk?: boolean
  qualitySignError?: string | null
}> {
  const inspect = inspectCookieForSigning(cookie)
  if (!isSignerEnabled()) {
    return {
      ok: false,
      hasXS: false,
      hasXT: false,
      hasXSCommon: false,
      hasAuthorization: false,
      hasA1: inspect.hasA1,
      hasWebSession: inspect.hasWebSession,
      message: SIGN_TEST_MESSAGES.signer_disabled,
      reason: 'signer_disabled',
      qualitySignOk: false,
      qualitySignError: SIGN_TEST_MESSAGES.signer_disabled,
    }
  }

  if (!inspect.hasA1) {
    return {
      ok: false,
      hasXS: false,
      hasXT: false,
      hasXSCommon: false,
      hasAuthorization: false,
      hasA1: false,
      hasWebSession: inspect.hasWebSession,
      message: SIGN_TEST_MESSAGES.cookie_missing_a1,
      reason: 'cookie_missing_a1',
      qualitySignOk: false,
      qualitySignError: SIGN_TEST_MESSAGES.cookie_missing_a1,
    }
  }
  if (!inspect.hasAccessTokenArk) {
    return {
      ok: false,
      hasXS: false,
      hasXT: false,
      hasXSCommon: false,
      hasAuthorization: false,
      hasA1: true,
      hasWebSession: inspect.hasWebSession,
      message: SIGN_TEST_MESSAGES.cookie_missing_access_token,
      reason: 'cookie_missing_access_token',
      qualitySignOk: false,
      qualitySignError: SIGN_TEST_MESSAGES.cookie_missing_access_token,
    }
  }

  const qualityTest = await runQualityBadcaseSignTest({ cookie })

  try {
    const headers = await signXhsRequest({
      method: 'POST',
      url: TEST_SIGN_URL,
      body: { data_condition: '{}', source_data_bean: 'OrderQueryPackageFileBuilder' },
      cookie,
    })
    const hasAuthorization = Boolean(headers.authorization?.startsWith('AT-'))
    if (!hasAuthorization) {
      return {
        ok: false,
        hasXS: Boolean(headers['x-s']),
        hasXT: Boolean(headers['x-t']),
        hasXSCommon: Boolean(headers['x-s-common']),
        hasAuthorization: false,
        hasA1: true,
        hasWebSession: inspect.hasWebSession,
        message: SIGN_TEST_MESSAGES.authorization_extract_failed,
        reason: 'authorization_extract_failed',
        qualitySignOk: qualityTest.ok,
        qualitySignError: qualityTest.ok ? null : qualityTest.message,
      }
    }
    return {
      ok: true,
      hasXS: true,
      hasXT: true,
      hasXSCommon: true,
      hasAuthorization: true,
      hasA1: true,
      hasWebSession: inspect.hasWebSession,
      message:
        '签名模块正常；Cookie 中已提取 Authorization；已生成 x-s / x-t / x-s-common（不向客户端返回明文）',
      qualitySignOk: qualityTest.ok,
      qualitySignError: qualityTest.ok ? null : qualityTest.message,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : SIGN_TEST_MESSAGES.sign_generation_failed
    let reason: SignTestFailureReason = 'sign_generation_failed'
    if (message.includes('未找到可用 Python')) reason = 'python_unavailable'
    else if (message.includes('xhshow') || message.includes('依赖')) reason = 'python_module_missing'
    else if (message.includes('脚本不存在')) reason = 'script_not_found'
    else if (message === SIGN_TEST_MESSAGES.authorization_extract_failed) {
      reason = 'authorization_extract_failed'
    }
    return {
      ok: false,
      hasXS: false,
      hasXT: false,
      hasXSCommon: false,
      hasAuthorization: inspect.canExtractAuthorization,
      hasA1: true,
      hasWebSession: inspect.hasWebSession,
      message,
      reason,
      qualitySignOk: qualityTest.ok,
      qualitySignError: qualityTest.ok ? null : qualityTest.message,
    }
  }
}
