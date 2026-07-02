import { useCallback, useState } from 'react'

const STORAGE_KEY = 'daily-report-show-attendance-v1'

/** 默认显示，与上线后行为一致；用户取消勾选后会记住偏好 */
export function readDailyReportShowAttendance(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

export function writeDailyReportShowAttendance(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}

export function useDailyReportShowAttendance(): [boolean, (value: boolean) => void] {
  const [show, setShow] = useState(() => readDailyReportShowAttendance())
  const set = useCallback((value: boolean) => {
    setShow(value)
    writeDailyReportShowAttendance(value)
  }, [])
  return [show, set]
}
