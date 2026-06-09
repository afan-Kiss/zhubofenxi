import fs from 'node:fs/promises'
import path from 'node:path'
import { getSetting, setSetting } from './system-setting.service'

export const APP_FAVICON_SETTING_KEY = 'appFaviconPath'

const MIME_BY_EXT: Record<string, string> = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const ALLOWED_EXT = new Set(Object.keys(MIME_BY_EXT))

export async function getAppFaviconPathSetting(): Promise<string> {
  const raw = await getSetting(APP_FAVICON_SETTING_KEY)
  return raw?.trim() ?? ''
}

export async function setAppFaviconPathSetting(filePath: string): Promise<string> {
  const trimmed = filePath.trim()
  if (!trimmed) {
    await setSetting(APP_FAVICON_SETTING_KEY, '')
    return ''
  }
  const normalized = path.normalize(trimmed)
  if (!path.isAbsolute(normalized)) {
    throw new Error('请填写本地绝对路径，例如 C:\\Users\\xxx\\logo.ico')
  }
  try {
    const stat = await fs.stat(normalized)
    if (!stat.isFile()) {
      throw new Error('路径不是有效文件')
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('不是有效文件')) throw e
    throw new Error('图标文件不存在或无法读取，请检查路径')
  }
  const ext = path.extname(normalized).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error('不支持该格式，请使用 .ico .png .jpg .jpeg .svg .webp')
  }
  await setSetting(APP_FAVICON_SETTING_KEY, normalized)
  return normalized
}

export async function readAppFaviconFile(): Promise<{
  buffer: Buffer
  contentType: string
} | null> {
  const filePath = await getAppFaviconPathSetting()
  if (!filePath) return null

  const normalized = path.normalize(filePath)
  if (!path.isAbsolute(normalized)) return null

  const ext = path.extname(normalized).toLowerCase()
  const contentType = MIME_BY_EXT[ext]
  if (!contentType) return null

  try {
    const stat = await fs.stat(normalized)
    if (!stat.isFile()) return null
    const buffer = await fs.readFile(normalized)
    if (!buffer.length) return null
    return { buffer, contentType }
  } catch {
    return null
  }
}
