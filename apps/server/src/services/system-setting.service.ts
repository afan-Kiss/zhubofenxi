import { prisma } from '../lib/prisma'
import type { DateRangePreset } from '../utils/date-range'

export type AmountDisplayMode = 'full' | 'wan'

const AMOUNT_DISPLAY_DEFAULT: AmountDisplayMode = 'wan'

export interface AutoRefreshSettings {
  autoRefreshEnabled: boolean
  autoRefreshTime: string
  autoRefreshPreset: DateRangePreset
  refreshTimezone: string
}

const DEFAULTS: AutoRefreshSettings = {
  autoRefreshEnabled: true,
  autoRefreshTime: '02:00',
  autoRefreshPreset: 'thisMonth',
  refreshTimezone: 'Asia/Shanghai',
}

const KEYS = Object.keys(DEFAULTS) as (keyof AutoRefreshSettings)[]

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function getAmountDisplayMode(): Promise<AmountDisplayMode> {
  await ensureDefaultSettings()
  const v = await getSetting('amountDisplayMode')
  return v === 'full' ? 'full' : AMOUNT_DISPLAY_DEFAULT
}

export async function setAmountDisplayMode(mode: AmountDisplayMode): Promise<AmountDisplayMode> {
  if (mode !== 'full' && mode !== 'wan') {
    throw new Error('amountDisplayMode 必须是 full 或 wan')
  }
  await setSetting('amountDisplayMode', mode)
  return mode
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export interface CleanupSettings {
  keepDownloadDays: number
  keepReportDays: number
  keepBackupDays: number
}

const CLEANUP_DEFAULTS: CleanupSettings = {
  keepDownloadDays: 30,
  keepReportDays: 90,
  keepBackupDays: 30,
}

const CLEANUP_KEYS = Object.keys(CLEANUP_DEFAULTS) as (keyof CleanupSettings)[]

export async function ensureDefaultSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const existing = await getSetting(key)
    if (existing == null) {
      await setSetting(key, String(value))
    }
  }
  for (const [key, value] of Object.entries(CLEANUP_DEFAULTS)) {
    const existing = await getSetting(key)
    if (existing == null) {
      await setSetting(key, String(value))
    }
  }
  await ensureApiSyncDefaultSettings()
  const existingAmountMode = await getSetting('amountDisplayMode')
  if (existingAmountMode == null) {
    await setSetting('amountDisplayMode', AMOUNT_DISPLAY_DEFAULT)
  }
}

export async function getCleanupSettings(): Promise<CleanupSettings> {
  await ensureDefaultSettings()
  const result = { ...CLEANUP_DEFAULTS }
  for (const key of CLEANUP_KEYS) {
    const v = await getSetting(key)
    if (v == null) continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 1) {
      result[key] = Math.floor(n)
    }
  }
  return result
}

export async function updateCleanupSettings(
  input: Partial<CleanupSettings>,
): Promise<CleanupSettings> {
  for (const key of CLEANUP_KEYS) {
    const val = input[key]
    if (val !== undefined) {
      if (!Number.isFinite(val) || val < 1) {
        throw new Error(`${key} 必须为正整数`)
      }
      await setSetting(key, String(Math.floor(val)))
    }
  }
  return getCleanupSettings()
}

export async function getAutoRefreshSettings(): Promise<AutoRefreshSettings> {
  await ensureDefaultSettings()
  const result = { ...DEFAULTS }
  for (const key of KEYS) {
    const v = await getSetting(key)
    if (v == null) continue
    if (key === 'autoRefreshEnabled') {
      result.autoRefreshEnabled = v === 'true' || v === '1'
    } else if (key === 'autoRefreshPreset') {
      result.autoRefreshPreset = v as DateRangePreset
    } else {
      result[key] = v as never
    }
  }
  return result
}

export async function updateAutoRefreshSettings(
  input: Partial<AutoRefreshSettings>,
): Promise<AutoRefreshSettings> {
  if (input.autoRefreshEnabled !== undefined) {
    await setSetting('autoRefreshEnabled', String(input.autoRefreshEnabled))
  }
  if (input.autoRefreshTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(input.autoRefreshTime)) {
      throw new Error('自动刷新时间格式应为 HH:mm')
    }
    await setSetting('autoRefreshTime', input.autoRefreshTime)
  }
  if (input.autoRefreshPreset !== undefined) {
    await setSetting('autoRefreshPreset', input.autoRefreshPreset)
  }
  if (input.refreshTimezone !== undefined) {
    await setSetting('refreshTimezone', input.refreshTimezone)
  }
  return getAutoRefreshSettings()
}

export interface ApiSyncSettings {
  apiSyncEnabled: boolean
  apiSyncTime: string
  apiSyncPreset: DateRangePreset
  refreshTimezone: string
  xhsRequestIntervalMs: number
  syncOrderDetailEnabled: boolean
  syncLiveDetailEnabled: boolean
  syncPendingSettlementEnabled: boolean
  syncSettledSettlementEnabled: boolean
}

export interface NotificationSettings {
  notificationEnabled: boolean
  notificationChannel: string
  notificationTime: string
}

const API_SYNC_DEFAULTS: ApiSyncSettings = {
  apiSyncEnabled: true,
  apiSyncTime: '02:00',
  apiSyncPreset: 'today',
  refreshTimezone: 'Asia/Shanghai',
  xhsRequestIntervalMs: 1000,
  syncOrderDetailEnabled: false,
  syncLiveDetailEnabled: false,
  syncPendingSettlementEnabled: true,
  syncSettledSettlementEnabled: true,
}

const NOTIFICATION_DEFAULTS: NotificationSettings = {
  notificationEnabled: false,
  notificationChannel: 'none',
  notificationTime: '09:00',
}

const API_SYNC_KEYS = Object.keys(API_SYNC_DEFAULTS) as (keyof ApiSyncSettings)[]
const NOTIFICATION_KEYS = Object.keys(NOTIFICATION_DEFAULTS) as (keyof NotificationSettings)[]

export async function ensureApiSyncDefaultSettings(): Promise<void> {
  for (const [key, value] of Object.entries(API_SYNC_DEFAULTS)) {
    const existing = await getSetting(key)
    if (existing == null) {
      await setSetting(key, String(value))
    }
  }
  if ((await getSetting('apiSyncPresets')) == null) {
    await setSetting('apiSyncPresets', JSON.stringify(DEFAULT_SCHEDULED_PRESETS))
  }
  await ensureSyncStrategyDefaults()
  for (const [key, value] of Object.entries(NOTIFICATION_DEFAULTS)) {
    const existing = await getSetting(key)
    if (existing == null) {
      await setSetting(key, String(value))
    }
  }
}

export async function getApiSyncSettings(): Promise<ApiSyncSettings> {
  await ensureDefaultSettings()
  await ensureApiSyncDefaultSettings()
  const result = { ...API_SYNC_DEFAULTS }
  for (const key of API_SYNC_KEYS) {
    const v = await getSetting(key)
    if (v == null) continue
    if (
      key === 'apiSyncEnabled' ||
      key === 'syncOrderDetailEnabled' ||
      key === 'syncLiveDetailEnabled' ||
      key === 'syncPendingSettlementEnabled' ||
      key === 'syncSettledSettlementEnabled'
    ) {
      result[key] = v === 'true' || v === '1'
    } else if (key === 'xhsRequestIntervalMs') {
      const n = Number(v)
      if (Number.isFinite(n)) result[key] = Math.max(1000, Math.floor(n))
    } else if (key === 'apiSyncPreset') {
      result.apiSyncPreset = v as DateRangePreset
    } else if (key === 'apiSyncTime') {
      result.apiSyncTime = v
    } else if (key === 'refreshTimezone') {
      result.refreshTimezone = v
    }
  }
  return result
}

export async function updateApiSyncSettings(
  input: Partial<ApiSyncSettings>,
): Promise<ApiSyncSettings> {
  const before = await getApiSyncSettings()
  if (input.apiSyncEnabled !== undefined) {
    await setSetting('apiSyncEnabled', String(input.apiSyncEnabled))
  }
  if (input.apiSyncTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(input.apiSyncTime)) {
      throw new Error('同步时间格式应为 HH:mm')
    }
    await setSetting('apiSyncTime', input.apiSyncTime)
  }
  if (input.apiSyncPreset !== undefined) {
    await setSetting('apiSyncPreset', input.apiSyncPreset)
  }
  if (input.refreshTimezone !== undefined) {
    await setSetting('refreshTimezone', input.refreshTimezone)
  }
  if (input.xhsRequestIntervalMs !== undefined) {
    const ms = Math.max(1000, Math.floor(input.xhsRequestIntervalMs))
    await setSetting('xhsRequestIntervalMs', String(ms))
  }
  if (input.syncOrderDetailEnabled !== undefined) {
    await setSetting('syncOrderDetailEnabled', String(input.syncOrderDetailEnabled))
  }
  if (input.syncLiveDetailEnabled !== undefined) {
    await setSetting('syncLiveDetailEnabled', String(input.syncLiveDetailEnabled))
  }
  if (input.syncPendingSettlementEnabled !== undefined) {
    await setSetting('syncPendingSettlementEnabled', String(input.syncPendingSettlementEnabled))
  }
  if (input.syncSettledSettlementEnabled !== undefined) {
    await setSetting('syncSettledSettlementEnabled', String(input.syncSettledSettlementEnabled))
  }
  const saved = await getApiSyncSettings()
  if (input.apiSyncEnabled === true && !before.apiSyncEnabled && saved.apiSyncEnabled) {
    await rescheduleApiSyncFromSettings()
    const { triggerBusinessSyncIfStale } = await import('./business-sync-scheduler.service')
    void triggerBusinessSyncIfStale('startup')
  }
  return saved
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  await ensureApiSyncDefaultSettings()
  const result = { ...NOTIFICATION_DEFAULTS }
  for (const key of NOTIFICATION_KEYS) {
    const v = await getSetting(key)
    if (v == null) continue
    if (key === 'notificationEnabled') {
      result.notificationEnabled = v === 'true' || v === '1'
    } else {
      result[key] = v as never
    }
  }
  return result
}

let rescheduleApiSyncHook: (() => Promise<void>) | null = null

export function registerApiSyncRescheduleHook(fn: () => Promise<void>): void {
  rescheduleApiSyncHook = fn
}

export async function rescheduleApiSyncFromSettings(): Promise<void> {
  if (rescheduleApiSyncHook) {
    await rescheduleApiSyncHook()
  }
}

const DEFAULT_SCHEDULED_PRESETS: DateRangePreset[] = ['today', 'thisMonth']

export interface SyncStrategySettings {
  /** 新订单滚动同步天数 */
  orderRollingDays: number
  /** 售后/退款回溯天数 */
  afterSaleLookbackDays: number
  /** 结算账单回溯天数 */
  settlementLookbackDays: number
  /** 售后观察期（天） */
  afterSaleObservationDays: number
  /** 月结修正期起始日（每月几号） */
  monthClosingStartDay: number
  /** 月结修正期结束日（每月几号） */
  monthClosingEndDay: number
}

const SYNC_STRATEGY_DEFAULTS: SyncStrategySettings = {
  orderRollingDays: 180,
  afterSaleLookbackDays: 180,
  settlementLookbackDays: 90,
  afterSaleObservationDays: 30,
  monthClosingStartDay: 1,
  monthClosingEndDay: 10,
}

const SYNC_STRATEGY_KEYS = Object.keys(SYNC_STRATEGY_DEFAULTS) as (keyof SyncStrategySettings)[]

export async function ensureSyncStrategyDefaults(): Promise<void> {
  for (const [key, value] of Object.entries(SYNC_STRATEGY_DEFAULTS)) {
    const existing = await getSetting(key)
    if (existing == null) {
      await setSetting(key, String(value))
      continue
    }
    if (key === 'orderRollingDays' || key === 'afterSaleLookbackDays') {
      const n = Number(existing)
      if (n === 30 || n === 90) {
        await setSetting(key, '180')
      }
    }
  }
}

export async function getSyncStrategySettings(): Promise<SyncStrategySettings> {
  await ensureApiSyncDefaultSettings()
  await ensureSyncStrategyDefaults()
  const result = { ...SYNC_STRATEGY_DEFAULTS }
  for (const key of SYNC_STRATEGY_KEYS) {
    const v = await getSetting(key)
    if (v == null) continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 1) {
      result[key] = Math.floor(n)
    }
  }
  if (result.monthClosingStartDay > result.monthClosingEndDay) {
    result.monthClosingStartDay = SYNC_STRATEGY_DEFAULTS.monthClosingStartDay
    result.monthClosingEndDay = SYNC_STRATEGY_DEFAULTS.monthClosingEndDay
  }
  return result
}

export async function updateSyncStrategySettings(
  input: Partial<SyncStrategySettings>,
): Promise<SyncStrategySettings> {
  for (const key of SYNC_STRATEGY_KEYS) {
    const val = input[key]
    if (val !== undefined) {
      if (!Number.isFinite(val) || val < 1) {
        throw new Error(`${key} 必须为正整数`)
      }
      await setSetting(key, String(Math.floor(val)))
    }
  }
  return getSyncStrategySettings()
}

function normalizeSchedulePreset(p: string): DateRangePreset | null {
  if (p === 'last7days') return 'last7'
  if (p === 'last15days') return 'last15'
  const allowed: DateRangePreset[] = [
    'today',
    'yesterday',
    'last7',
    'last15',
    'thisMonth',
    'lastMonth',
    'custom',
  ]
  return allowed.includes(p as DateRangePreset) ? (p as DateRangePreset) : null
}

export async function getApiSyncPresets(): Promise<DateRangePreset[]> {
  await ensureApiSyncDefaultSettings()
  const raw = await getSetting('apiSyncPresets')
  if (!raw) return [...DEFAULT_SCHEDULED_PRESETS]
  try {
    const parsed = JSON.parse(raw) as string[]
    if (!Array.isArray(parsed)) return [...DEFAULT_SCHEDULED_PRESETS]
    const out: DateRangePreset[] = []
    for (const p of parsed) {
      const n = normalizeSchedulePreset(String(p))
      if (n && n !== 'custom' && !out.includes(n)) out.push(n)
    }
    return out.length > 0 ? out : [...DEFAULT_SCHEDULED_PRESETS]
  } catch {
    return [...DEFAULT_SCHEDULED_PRESETS]
  }
}

export async function setApiSyncPresets(presets: DateRangePreset[]): Promise<void> {
  const cleaned = presets
    .map((p) => normalizeSchedulePreset(p))
    .filter((p): p is DateRangePreset => p != null && p !== 'custom')
  const unique = [...new Set(cleaned)]
  await setSetting('apiSyncPresets', JSON.stringify(unique.length > 0 ? unique : DEFAULT_SCHEDULED_PRESETS))
}
