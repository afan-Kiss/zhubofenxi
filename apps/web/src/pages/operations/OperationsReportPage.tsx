import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDaysShanghai, formatDateKeyShanghai } from '../../lib/business-timezone'
import { OperationsDailyReport } from './OperationsDailyReport'
import { OperationsWeeklyReport } from './OperationsWeeklyReport'
import { OperationsRankingsTab } from './OperationsRankingsTab'

function yesterdayKey(): string {
  const today = formatDateKeyShanghai(new Date())
  return addDaysShanghai(today, -1)
}

function thisWeekRange(): { weekStart: string; weekEnd: string } {
  const today = formatDateKeyShanghai(new Date())
  const day = new Date(`${today}T12:00:00+08:00`).getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const weekStart = addDaysShanghai(today, mondayOffset)
  return { weekStart, weekEnd: today }
}

type Tab = 'daily' | 'weekly' | 'rankings'

export const OperationsReportPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab =
    tabParam === 'weekly' ? 'weekly' : tabParam === 'rankings' ? 'rankings' : 'daily'
  const defaultDailyDate = yesterdayKey()
  const defaultWeek = thisWeekRange()

  const [dailyDate, setDailyDate] = useState(
    searchParams.get('date')?.trim() || defaultDailyDate,
  )
  const [weekStart, setWeekStart] = useState(
    searchParams.get('weekStart')?.trim() || defaultWeek.weekStart,
  )
  const [weekEnd, setWeekEnd] = useState(
    searchParams.get('weekEnd')?.trim() || defaultWeek.weekEnd,
  )
  const [rankStart, setRankStart] = useState(
    searchParams.get('rankStart')?.trim() || defaultWeek.weekStart,
  )
  const [rankEnd, setRankEnd] = useState(
    searchParams.get('rankEnd')?.trim() || defaultWeek.weekEnd,
  )

  const syncQuery = useMemo(() => {
    const next = new URLSearchParams()
    next.set('tab', tab)
    if (tab === 'daily') {
      next.set('date', dailyDate)
    } else if (tab === 'weekly') {
      next.set('weekStart', weekStart)
      next.set('weekEnd', weekEnd)
    } else {
      next.set('rankStart', rankStart)
      next.set('rankEnd', rankEnd)
    }
    return next
  }, [tab, dailyDate, weekStart, weekEnd, rankStart, rankEnd])

  React.useEffect(() => {
    setSearchParams(syncQuery, { replace: true })
  }, [syncQuery, setSearchParams])

  const tabBtn = (id: Tab, label: string, params: Record<string, string>) => (
    <button
      type="button"
      onClick={() => setSearchParams({ tab: id, ...params })}
      className={`rounded-full px-4 py-2 text-sm ${
        tab === id ? 'bg-rose-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 md:px-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">运营报表</h1>
        <p className="mt-1 text-sm text-slate-500">日报、周报与榜单中心</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabBtn('daily', '日报', { date: dailyDate })}
        {tabBtn('weekly', '周报', { weekStart, weekEnd })}
        {tabBtn('rankings', '榜单中心', { rankStart, rankEnd })}
      </div>

      {tab === 'daily' ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">
            日期
            <input
              type="date"
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
              className="ml-2 rounded-xl border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        </div>
      ) : tab === 'weekly' ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">
            周起始
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="ml-2 rounded-xl border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm text-slate-600">
            周结束
            <input
              type="date"
              value={weekEnd}
              onChange={(e) => setWeekEnd(e.target.value)}
              className="ml-2 rounded-xl border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        </div>
      ) : null}

      {tab === 'daily' ? (
        <OperationsDailyReport dateKey={dailyDate} />
      ) : tab === 'weekly' ? (
        <OperationsWeeklyReport weekStart={weekStart} weekEnd={weekEnd} />
      ) : (
        <OperationsRankingsTab startDate={rankStart} endDate={rankEnd} preset="custom" />
      )}
    </div>
  )
}
