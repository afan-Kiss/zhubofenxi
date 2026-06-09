import { prisma } from '../lib/prisma'
import { getXhsSellerId } from '../config/env'
import {
  DEFAULT_DOWNLOAD_CONFIGS,
  type DownloadMode,
  type DownloadType,
  isDownloadMode,
  isDownloadType,
} from '../types/download'

export interface DownloadConfigView {
  id: string
  type: DownloadType
  name: string
  url: string
  method: string
  mode: DownloadMode
  sellerId: string | null
  enabled: boolean
  remark: string | null
  updatedAt: Date
}

const AUTO_EXPORT_TYPES: DownloadType[] = [
  'order',
  'live',
  'pendingSettlement',
  'settledSettlement',
]

export function isValidDirectDownloadUrl(url: string | null | undefined): boolean {
  const t = (url ?? '').trim()
  if (!t || t.startsWith('xhs://')) return false
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function resolveEffectiveDownloadMode(
  type: DownloadType,
  storedMode: string,
  url: string,
): DownloadMode {
  if (!AUTO_EXPORT_TYPES.includes(type)) {
    return isDownloadMode(storedMode) ? storedMode : 'direct_url'
  }
  if (storedMode === 'direct_url' && isValidDirectDownloadUrl(url)) {
    return 'direct_url'
  }
  return 'auto_export'
}

function placeholderUrlForType(type: DownloadType): string {
  switch (type) {
    case 'order':
      return 'xhs://export-api'
    case 'live':
      return 'xhs://live-export-api'
    case 'settledSettlement':
      return 'xhs://settled-export-api'
    case 'pendingSettlement':
      return 'xhs://pending-export-api'
    default:
      return ''
  }
}

/** 将无效 direct_url（空 URL / xhs:// 占位）恢复为 auto_export，并写回数据库 */
export async function migrateLegacyDownloadModes(): Promise<void> {
  await ensureDefaultDownloadConfigs()
  for (const type of AUTO_EXPORT_TYPES) {
    const row = await prisma.downloadConfig.findUnique({ where: { type } })
    if (!row) continue
    const effective = resolveEffectiveDownloadMode(type, row.mode, row.url)
    const targetUrl =
      effective === 'auto_export' ? placeholderUrlForType(type) : row.url.trim()
    if (row.mode !== effective || (effective === 'auto_export' && row.url !== targetUrl)) {
      await prisma.downloadConfig.update({
        where: { type },
        data: {
          mode: effective,
          url: targetUrl,
        },
      })
    }
  }
}

/** 四张表全部恢复为接口自动导出（super_admin 一键修复） */
export async function restoreAllDownloadConfigsToAutoExport(): Promise<DownloadConfigView[]> {
  await ensureDefaultDownloadConfigs()
  for (const type of AUTO_EXPORT_TYPES) {
    await prisma.downloadConfig.update({
      where: { type },
      data: {
        mode: 'auto_export',
        url: placeholderUrlForType(type),
      },
    })
  }
  return listDownloadConfigs()
}

export function getEffectiveDownloadMode(
  type: DownloadType,
  config: Pick<DownloadConfigView, 'mode' | 'url'>,
): DownloadMode {
  return resolveEffectiveDownloadMode(type, config.mode, config.url)
}

function toView(row: {
  id: string
  type: string
  name: string
  url: string
  method: string
  mode: string
  sellerId: string | null
  enabled: boolean
  remark: string | null
  updatedAt: Date
}): DownloadConfigView {
  if (!isDownloadType(row.type)) {
    throw new Error(`未知下载类型：${row.type}`)
  }
  const mode = resolveEffectiveDownloadMode(row.type, row.mode, row.url)
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    url: row.url,
    method: row.method,
    mode,
    sellerId: row.sellerId,
    enabled: row.enabled,
    remark: row.remark,
    updatedAt: row.updatedAt,
  }
}

/** @deprecated Excel 下载主流程已废弃，配置保留仅供旧代码编译 */
export async function ensureDefaultDownloadConfigs(): Promise<void> {
  for (const item of DEFAULT_DOWNLOAD_CONFIGS) {
    const isLive = item.type === 'live'
    const isSettled = item.type === 'settledSettlement'
    const isPending = item.type === 'pendingSettlement'
    const autoExport = isLive || isSettled || isPending || item.type === 'order'
    await prisma.downloadConfig.upsert({
      where: { type: item.type },
      create: {
        type: item.type,
        name: item.name,
        url: placeholderUrlForType(item.type),
        method: 'GET',
        mode: autoExport ? 'auto_export' : 'direct_url',
        sellerId: null,
        enabled: false,
        remark: null,
      },
      update: {},
    })
  }
}

export async function listDownloadConfigs(): Promise<DownloadConfigView[]> {
  await ensureDefaultDownloadConfigs()
  await migrateLegacyDownloadModes()
  const rows = await prisma.downloadConfig.findMany({
    orderBy: { type: 'asc' },
  })
  return rows.map(toView)
}

export function validateDownloadUrl(url: string): void {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new Error('下载链接不能为空')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('下载链接格式无效，必须是 http 或 https 地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('下载链接必须是 http 或 https')
  }
}

export function resolveLiveSellerId(configSellerId: string | null): string {
  const id = configSellerId?.trim() || getXhsSellerId()
  if (!id) {
    throw new Error('请先在系统设置填写小红书 sellerId，或在环境变量中配置 XHS_SELLER_ID')
  }
  return id
}

export async function updateDownloadConfig(
  type: DownloadType,
  input: {
    name: string
    url: string
    method?: string
    mode?: string
    sellerId?: string
    enabled?: boolean
    remark?: string
  },
): Promise<DownloadConfigView> {
  await ensureDefaultDownloadConfigs()

  const mode: DownloadMode =
    input.mode && isDownloadMode(input.mode)
      ? input.mode
      : type === 'order' ||
          type === 'live' ||
          type === 'settledSettlement' ||
          type === 'pendingSettlement'
        ? 'auto_export'
        : 'direct_url'

  if (mode === 'direct_url') {
    if (
      type === 'order' ||
      type === 'live' ||
      type === 'pendingSettlement' ||
      type === 'settledSettlement'
    ) {
      validateDownloadUrl(input.url)
    } else {
      validateDownloadUrl(input.url)
    }
  }

  let url = input.url.trim()
  if (type === 'order') {
    url = mode === 'direct_url' ? url : 'xhs://export-api'
  } else if (type === 'live' && mode === 'auto_export') {
    url = 'xhs://live-export-api'
  } else if (type === 'settledSettlement' && mode === 'auto_export') {
    url = 'xhs://settled-export-api'
  } else if (type === 'pendingSettlement' && mode === 'auto_export') {
    url = 'xhs://pending-export-api'
  }

  const row = await prisma.downloadConfig.update({
    where: { type },
    data: {
      name: input.name.trim() || DEFAULT_DOWNLOAD_CONFIGS.find((d) => d.type === type)!.name,
      url,
      method: (input.method ?? 'GET').toUpperCase(),
      mode,
      sellerId: type === 'live' ? input.sellerId?.trim() || null : null,
      enabled: input.enabled ?? true,
      remark: input.remark?.trim() || null,
    },
  })
  return toView(row)
}

export async function isDownloadTypeEnabled(type: DownloadType): Promise<boolean> {
  const row = await prisma.downloadConfig.findUnique({ where: { type } })
  return Boolean(row?.enabled)
}

export async function isDownloadTypeAvailable(type: DownloadType): Promise<boolean> {
  const row = await prisma.downloadConfig.findUnique({ where: { type } })
  if (!row?.enabled) return false

  if (type === 'order') {
    const mode = resolveEffectiveDownloadMode(type, row.mode, row.url)
    if (mode === 'direct_url') {
      return isValidDirectDownloadUrl(row.url)
    }
    return true
  }

  if (type === 'live') {
    const mode = resolveEffectiveDownloadMode(type, row.mode, row.url)
    if (mode === 'auto_export') {
      try {
        resolveLiveSellerId(row.sellerId)
        return true
      } catch {
        return false
      }
    }
    return Boolean(row.url.trim() && !row.url.startsWith('xhs://'))
  }

  if (type === 'settledSettlement') {
    const mode = resolveEffectiveDownloadMode(type, row.mode, row.url)
    if (mode === 'auto_export') return true
    return isValidDirectDownloadUrl(row.url)
  }

  if (type === 'pendingSettlement') {
    const mode = resolveEffectiveDownloadMode(type, row.mode, row.url)
    if (mode === 'auto_export') return true
    return isValidDirectDownloadUrl(row.url)
  }

  return Boolean(row.url.trim() && !row.url.startsWith('xhs://'))
}

export async function getDownloadConfig(type: DownloadType): Promise<DownloadConfigView | null> {
  await ensureDefaultDownloadConfigs()
  await migrateLegacyDownloadModes()
  const row = await prisma.downloadConfig.findUnique({ where: { type } })
  return row ? toView(row) : null
}

export async function getEnabledDownloadConfig(
  type: DownloadType,
): Promise<DownloadConfigView | null> {
  const row = await prisma.downloadConfig.findUnique({ where: { type } })
  if (!row || !row.enabled) return null

  if (type === 'order') return toView(row)

  if (type === 'live') {
    const view = toView(row)
    if (view.mode === 'auto_export') return view
    if (!row.url.trim() || row.url.startsWith('xhs://')) return null
    return view
  }

  if (type === 'settledSettlement') {
    const view = toView(row)
    if (view.mode === 'auto_export') return view
    if (!row.url.trim() || row.url.startsWith('xhs://')) return null
    return view
  }

  if (type === 'pendingSettlement') {
    const view = toView(row)
    if (view.mode === 'auto_export') return view
    if (!row.url.trim() || row.url.startsWith('xhs://')) return null
    return view
  }

  if (!row.url.trim() || row.url.startsWith('xhs://')) return null
  return toView(row)
}
