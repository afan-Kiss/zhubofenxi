export const SETTINGS_UNLOCK_KEY = 'board_settings_unlocked'

export function isSettingsUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SETTINGS_UNLOCK_KEY) === 'true'
  } catch {
    return false
  }
}

export function unlockSettings(): void {
  try {
    sessionStorage.setItem(SETTINGS_UNLOCK_KEY, 'true')
  } catch {
    /* ignore */
  }
}

export function lockSettings(): void {
  try {
    sessionStorage.removeItem(SETTINGS_UNLOCK_KEY)
  } catch {
    /* ignore */
  }
}

/** 本机管理锁密码（仅前端校验，不展示在 UI） */
const SETTINGS_PASSWORD = 'fanfan9724'

export function verifySettingsPassword(input: string): boolean {
  return input.trim() === SETTINGS_PASSWORD
}
