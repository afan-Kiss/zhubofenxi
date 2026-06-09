import fs from 'node:fs'
import path from 'node:path'
import { getBackupDir, getDownloadDir, getReportDir } from '../config/env'
import { getCleanupSettings } from './system-setting.service'

export interface CleanupPreview {
  downloadFiles: number
  reportFiles: number
  backupFiles: number
  estimatedBytes: number
  keepDownloadDays: number
  keepReportDays: number
  keepBackupDays: number
}

function dirSizeAndOldFiles(
  dir: string,
  maxAgeDays: number,
): { count: number; bytes: number; paths: string[] } {
  if (!fs.existsSync(dir)) {
    return { count: 0, bytes: 0, paths: [] }
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  const paths: string[] = []
  let bytes = 0

  const walk = (p: string) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, ent.name)
      if (ent.isDirectory()) {
        walk(full)
        continue
      }
      if (!ent.isFile()) continue
      const stat = fs.statSync(full)
      if (stat.mtimeMs < cutoff) {
        paths.push(full)
        bytes += stat.size
      }
    }
  }
  walk(dir)
  return { count: paths.length, bytes, paths }
}

export async function previewCleanup(): Promise<CleanupPreview> {
  const settings = await getCleanupSettings()
  const d = dirSizeAndOldFiles(getDownloadDir(), settings.keepDownloadDays)
  const r = dirSizeAndOldFiles(getReportDir(), settings.keepReportDays)
  const b = dirSizeAndOldFiles(getBackupDir(), settings.keepBackupDays)

  return {
    downloadFiles: d.count,
    reportFiles: r.count,
    backupFiles: b.count,
    estimatedBytes: d.bytes + r.bytes + b.bytes,
    keepDownloadDays: settings.keepDownloadDays,
    keepReportDays: settings.keepReportDays,
    keepBackupDays: settings.keepBackupDays,
  }
}

export async function runCleanup(dryRun: boolean): Promise<CleanupPreview & { deleted: number }> {
  const settings = await getCleanupSettings()
  const d = dirSizeAndOldFiles(getDownloadDir(), settings.keepDownloadDays)
  const r = dirSizeAndOldFiles(getReportDir(), settings.keepReportDays)
  const b = dirSizeAndOldFiles(getBackupDir(), settings.keepBackupDays)

  const allPaths = [...d.paths, ...r.paths, ...b.paths]
  if (!dryRun) {
    for (const p of allPaths) {
      try {
        fs.unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
  }

  return {
    downloadFiles: d.count,
    reportFiles: r.count,
    backupFiles: b.count,
    estimatedBytes: d.bytes + r.bytes + b.bytes,
    keepDownloadDays: settings.keepDownloadDays,
    keepReportDays: settings.keepReportDays,
    keepBackupDays: settings.keepBackupDays,
    deleted: dryRun ? 0 : allPaths.length,
  }
}
