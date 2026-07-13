import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDaysShanghai, formatDateKeyShanghai } from '../../lib/business-timezone'
import { resolveOperationsReportDateRange } from '../../lib/data-freshness'
import { DataLastUpdateBanner } from '../../components/board/DataLastUpdateBanner'
import { useDataFreshness } from '../../hooks/useDataFreshness'
import { OperationsDailyReport } from './OperationsDailyReport'
import { OperationsWeeklyReport } from './OperationsWeeklyReport'
import { OperationsMonthlyReport } from './OperationsMonthlyReport'
import { OperationsRankingsTab } from './OperationsRankingsTab'
import { OperationsBiDrillProvider } from '../../components/operations/OperationsBiDrillProvider'

type Tab = 'daily' | 'weekly' | 'monthly' | 'rankings'

function OperationsReportDateControls({
  tab,
  disabled,
  dailyDate,
  weekStart,
  weekEnd,
  monthKey,
  onDailyDate,
  onWeekStart,
  onWeekEnd,
  onMonthKey,
}: {
  tab: Tab
  disabled: boolean
  dailyDate: string
  weekStart: string
  weekEnd: string
  monthKey: string
  onDailyDate: (v: string) => void
  onWeekStart: (v: string) => void
  onWeekEnd: (v: string) => void
  onMonthKey: (v: string) => void
}) {
  return (
    <div className="min-h-[2.75rem] transition-opacity duration-200">
      {tab === 'daily' ? (
        <label className="inline-flex items-center text-sm text-slate-600">
          日期
          <input
            type="date"
            disabled={disabled}
            value={dailyDate}
            onChange={(e) => onDailyDate(e.target.value)}
            className="ml-2 rounded-xl border border-slate-200 px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
      ) : tab === 'weekly' ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">
            周起始
            <input
              type="date"
              disabled={disabled}
              value={weekStart}
              onChange={(e) => onWeekStart(e.target.value)}
              className="ml-2 rounded-xl border border-slate-200 px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
          <label className="text-sm text-slate-600">
            周结束
            <input
              type="date"
              disabled={disabled}
              value={weekEnd}
              onChange={(e) => onWeekEnd(e.target.value)}
              className="ml-2 rounded-xl border border-slate-200 px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
        </div>
      ) : tab === 'monthly' ? (
        <label className="inline-flex items-center text-sm text-slate-600">
          月份
          <input
            type="month"
            disabled={disabled}
            value={monthKey}
            onChange={(e) => onMonthKey(e.target.value)}
            className="ml-2 rounded-xl border border-slate-200 px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
      ) : (
        <p className="text-xs text-slate-500">日期范围在下方榜单区域切换</p>
      )}
    </div>
  )
}

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

function thisMonthKey(): string {
  return formatDateKeyShanghai(new Date()).slice(0, 7)
}

export const OperationsReportPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab =
    tabParam === 'weekly'
      ? 'weekly'
      : tabParam === 'monthly'
        ? 'monthly'
        : tabParam === 'rankings'
          ? 'rankings'
          : 'daily'
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
  const [monthKey, setMonthKey] = useState(searchParams.get('month')?.trim() || thisMonthKey())
  const [rankStart, setRankStart] = useState(
    searchParams.get('rankStart')?.trim() || defaultWeek.weekStart,
  )
  const [rankEnd, setRankEnd] = useState(
    searchParams.get('rankEnd')?.trim() || defaultWeek.weekEnd,
  )
  const [reportLoading, setReportLoading] = useState(false)

  const reportDateRange = useMemo(
    () =>
      resolveOperationsReportDateRange({
        tab,
        dailyDate,
        weekStart,
        weekEnd,
        monthKey,
        rankStart,
        rankEnd,
      }),
    [tab, dailyDate, weekStart, weekEnd, monthKey, rankStart, rankEnd],
  )

  const { data: dataFreshness, loading: dataFreshnessLoading } = useDataFreshness(
    reportDateRange.startDate,
    reportDateRange.endDate,
  )

  const syncQuery = useMemo(() => {
    const next = new URLSearchParams()
    next.set('tab', tab)
    if (tab === 'daily') {
      next.set('date', dailyDate)
    } else if (tab === 'weekly') {
      next.set('weekStart', weekStart)
      next.set('weekEnd', weekEnd)
    } else if (tab === 'monthly') {
      next.set('month', monthKey)
    } else {
      next.set('rankStart', rankStart)
      next.set('rankEnd', rankEnd)
    }
    return next
  }, [tab, dailyDate, weekStart, weekEnd, monthKey, rankStart, rankEnd])

  React.useEffect(() => {
    setSearchParams(syncQuery, { replace: true })
  }, [syncQuery, setSearchParams])

  const tabBtn = (id: Tab, label: string, params: Record<string, string>) => (
    <button
      type="button"
      disabled={reportLoading}
      onClick={() => setSearchParams({ tab: id, ...params })}
      className={`rounded-full px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
        tab === id ? 'bg-rose-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
      }`}
    >
      {label}
    </button>
  )

  const dateControlDisabled = reportLoading

  return (
    <OperationsBiDrillProvider>
    <div className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 md:px-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">运营报表</h1>
        <p className="mt-1 text-sm text-slate-500">日报、周报、月报与榜单中心，一眼看懂经营情况</p>
        <DataLastUpdateBanner
          freshness={dataFreshness}
          loading={dataFreshnessLoading}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 transition-opacity duration-200">
        {tabBtn('daily', '日报', { date: dailyDate })}
        {tabBtn('weekly', '周报', { weekStart, weekEnd })}
        {tabBtn('monthly', '月报', { month: monthKey })}
        {tabBtn('rankings', '榜单中心', { rankStart, rankEnd })}
      </div>

      <OperationsReportDateControls
        tab={tab}
        disabled={dateControlDisabled}
        dailyDate={dailyDate}
        weekStart={weekStart}
        weekEnd={weekEnd}
        monthKey={monthKey}
        onDailyDate={setDailyDate}
        onWeekStart={setWeekStart}
        onWeekEnd={setWeekEnd}
        onMonthKey={setMonthKey}
      />

      <div className="relative min-h-[20rem]">
        <div key={tab} className="ops-report-tab-panel">
      {tab === 'daily' ? (
        <OperationsDailyReport key={dailyDate} dateKey={dailyDate} onLoadingChange={setReportLoading} />
      ) : tab === 'weekly' ? (
        <OperationsWeeklyReport
          key={`${weekStart}-${weekEnd}`}
          weekStart={weekStart}
          weekEnd={weekEnd}
          onLoadingChange={setReportLoading}
        />
      ) : tab === 'monthly' ? (
        <OperationsMonthlyReport key={monthKey} month={monthKey} onLoadingChange={setReportLoading} />
      ) : (
        <OperationsRankingsTab
          startDate={rankStart}
          endDate={rankEnd}
          preset="custom"
          onLoadingChange={setReportLoading}
        />
      )}
        </div>
      </div>
    </div>
    </OperationsBiDrillProvider>
  )
}
