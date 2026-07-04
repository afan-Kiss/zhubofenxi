import fs from 'node:fs'
import path from 'node:path'

/** 报告 JSON 结构版本；升级后旧报告应提示管理员重跑 */
export const MONTHLY_CLOSE_REPORT_SCHEMA_VERSION = 2

export function resolveReportBuildMeta(fullScan: boolean): {
  schemaVersion: number
  appVersion: string
  gitCommit: string
  fullScan: boolean
} {
  let appVersion = '0.2.0'
  try {
    const pkgPath = path.join(process.cwd(), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }
    appVersion = pkg.version ?? appVersion
  } catch {
    /* use default */
  }
  return {
    schemaVersion: MONTHLY_CLOSE_REPORT_SCHEMA_VERSION,
    appVersion: process.env.APP_VERSION ?? appVersion,
    gitCommit:
      process.env.GIT_COMMIT ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      'unknown',
    fullScan,
  }
}

export function isStaleMonthlyCloseReport(report: { schemaVersion?: number }): boolean {
  return (report.schemaVersion ?? 1) < MONTHLY_CLOSE_REPORT_SCHEMA_VERSION
}

/** 已有成功报告是否与当前构建元信息不一致，需重跑 */
export function isMonthlyCloseReportBuildStale(
  report: { schemaVersion?: number; gitCommit?: string; fullScan?: boolean },
  buildMeta: { schemaVersion: number; gitCommit: string; fullScan: boolean },
): boolean {
  if ((report.schemaVersion ?? 1) !== buildMeta.schemaVersion) return true
  if (report.fullScan !== buildMeta.fullScan) return true
  const reportCommit = report.gitCommit ?? 'unknown'
  const currentCommit = buildMeta.gitCommit ?? 'unknown'
  if (reportCommit !== 'unknown' && currentCommit !== 'unknown' && reportCommit !== currentCommit) {
    return true
  }
  return false
}
