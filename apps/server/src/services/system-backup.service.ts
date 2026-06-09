import fs from 'node:fs'
import path from 'node:path'
import archiver from 'archiver'
import { getBackupDir, getDatabasePath, getDownloadDir, getReportDir } from '../config/env'

export interface BackupRecord {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  createdAt: string
}

function listBackupFiles(): BackupRecord[] {
  const dir = getBackupDir()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((fileName) => {
      const filePath = path.join(dir, fileName)
      const stat = fs.statSync(filePath)
      return {
        id: fileName.replace(/\.zip$/, ''),
        fileName,
        filePath,
        fileSize: stat.size,
        createdAt: stat.mtime.toISOString(),
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listBackups(): BackupRecord[] {
  return listBackupFiles()
}

function formatBackupName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `backup_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.zip`
}

export async function createSystemBackup(): Promise<BackupRecord> {
  const dir = getBackupDir()
  const fileName = formatBackupName()
  const id = fileName.replace(/\.zip$/, '')
  const filePath = path.join(dir, fileName)

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(filePath)
    const archive = archiver('zip', { zlib: { level: 6 } })

    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))

    archive.pipe(output)

    const dbPath = getDatabasePath()
    if (fs.existsSync(dbPath)) {
      archive.file(dbPath, { name: 'database.sqlite' })
    }

    const downloadDir = getDownloadDir()
    if (fs.existsSync(downloadDir)) {
      archive.directory(downloadDir, 'downloads')
    }

    const reportDir = getReportDir()
    if (fs.existsSync(reportDir)) {
      archive.directory(reportDir, 'reports')
    }

    archive.append(
      '本备份不含 .env 与 Cookie 明文。请另行安全保存环境变量与平台登录配置。\n',
      { name: 'README_BACKUP.txt' },
    )

    void archive.finalize()
  })

  const stat = fs.statSync(filePath)
  return {
    id,
    fileName,
    filePath,
    fileSize: stat.size,
    createdAt: stat.mtime.toISOString(),
  }
}

export function getBackupById(id: string): BackupRecord | null {
  return listBackupFiles().find((b) => b.id === id) ?? null
}
