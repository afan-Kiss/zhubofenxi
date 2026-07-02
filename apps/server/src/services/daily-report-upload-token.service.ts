import { randomBytes } from 'node:crypto'

const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TOKEN_TTL_MS = 30 * 60 * 1000

interface UploadTokenEntry {
  reportDate: string
  expiresAt: number
  createdBy?: string
}

const tokens = new Map<string, UploadTokenEntry>()

function purgeExpiredTokens(now = Date.now()): void {
  for (const [token, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(token)
  }
}

export function createDailyReportUploadToken(
  reportDate: string,
  createdBy?: string,
): { token: string; expiresAt: string; expiresInSeconds: number } {
  if (!REPORT_DATE_RE.test(reportDate)) {
    throw new Error('date 格式应为 YYYY-MM-DD')
  }
  purgeExpiredTokens()
  const token = randomBytes(24).toString('hex')
  const expiresAt = Date.now() + TOKEN_TTL_MS
  tokens.set(token, { reportDate, expiresAt, createdBy })
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInSeconds: Math.floor(TOKEN_TTL_MS / 1000),
  }
}

export function validateDailyReportUploadToken(token: string, reportDate: string): boolean {
  const trimmed = token.trim()
  if (!trimmed || !REPORT_DATE_RE.test(reportDate)) return false
  purgeExpiredTokens()
  const entry = tokens.get(trimmed)
  if (!entry) return false
  if (entry.reportDate !== reportDate) return false
  if (entry.expiresAt <= Date.now()) {
    tokens.delete(trimmed)
    return false
  }
  return true
}

/** 仅用于验收脚本 */
export function clearDailyReportUploadTokensForTest(): void {
  tokens.clear()
}
