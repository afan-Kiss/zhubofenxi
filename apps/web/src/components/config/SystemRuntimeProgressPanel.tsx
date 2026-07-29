import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  barColorClass,
  statusBadgeClass,
  statusBadgeLabel,
  type RuntimeProgressSnapshot,
  type RuntimeTaskProgressItem,
} from '../../lib/runtime-progress'

const POLL_RUNNING_MS = 2000
const POLL_IDLE_MS = 5000

function TaskProgressRow({ task }: { task: RuntimeTaskProgressItem }) {
  const isShop = task.kind === 'after_sales_shop'
  const showBar = task.percent != null
  const showPulse = task.status === 'running' && task.percent == null

  return (
    <div
      className={`min-w-0 rounded-xl border px-3 py-2.5 ${
        isShop ? 'border-slate-100 bg-slate-50/80' : 'border-slate-200 bg-slate-50/60'
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={`truncate font-medium text-slate-900 ${
              isShop ? 'text-xs' : 'text-sm'
            }`}
            title={task.title}
          >
            {task.title}
          </p>
          <p className="mt-0.5 break-words text-xs leading-relaxed text-slate-600">
            {task.statusText}
          </p>
          {task.detailText ? (
            <p className="mt-0.5 break-words text-[11px] leading-relaxed text-slate-400">
              {task.detailText}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeClass(
            task.status,
          )}`}
        >
          {statusBadgeLabel(task.status)}
        </span>
      </div>

      {showBar ? (
        <div className="mt-2 min-w-0">
          <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="min-w-0 truncate">
              {task.countLabel ?? (task.status === 'idle' ? '空闲' : '进度')}
            </span>
            <span className="shrink-0 tabular-nums">{task.percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full max-w-full rounded-full transition-all duration-500 ${barColorClass(
                task.status,
              )}`}
              style={{ width: `${Math.min(100, Math.max(0, task.percent ?? 0))}%` }}
              role="progressbar"
              aria-valuenow={task.percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={task.title}
            />
          </div>
        </div>
      ) : null}

      {showPulse ? (
        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-sky-800">
          <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          <span className="min-w-0 truncate">任务进行中，正在更新进度…</span>
        </div>
      ) : null}
    </div>
  )
}

/** 嵌入「自动同步状态」卡片内的后台任务进度（无独立外框） */
export const SystemRuntimeProgressPanel: React.FC = () => {
  const [data, setData] = useState<RuntimeProgressSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const anyRunningRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveRef = useRef(true)
  const reqSeqRef = useRef(0)
  const loadRef = useRef<() => Promise<void>>(async () => undefined)

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const scheduleNext = useCallback(() => {
    clearTimer()
    if (!aliveRef.current) return
    const ms = anyRunningRef.current ? POLL_RUNNING_MS : POLL_IDLE_MS
    timerRef.current = setTimeout(() => {
      void loadRef.current()
    }, ms)
  }, [])

  const load = useCallback(async () => {
    if (!aliveRef.current) return
    if (typeof document !== 'undefined' && document.hidden) {
      scheduleNext()
      return
    }
    const seq = ++reqSeqRef.current
    try {
      const snap = await apiRequest<RuntimeProgressSnapshot>('/api/sync/runtime-progress')
      if (!aliveRef.current || seq !== reqSeqRef.current) return
      setData(snap)
      setError(null)
      anyRunningRef.current = Boolean(snap.anyRunning)
    } catch (err) {
      if (!aliveRef.current || seq !== reqSeqRef.current) return
      setError(err instanceof Error ? err.message : '读取后台任务进度失败')
    } finally {
      if (aliveRef.current && seq === reqSeqRef.current) {
        setLoading(false)
        scheduleNext()
      }
    }
  }, [scheduleNext])

  loadRef.current = load

  useEffect(() => {
    aliveRef.current = true
    void load()

    const onVisibility = () => {
      if (!document.hidden) {
        clearTimer()
        void load()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      aliveRef.current = false
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  const mainTasks = (data?.tasks ?? []).filter((t) => t.kind !== 'after_sales_shop')
  const shopTasks = (data?.tasks ?? []).filter((t) => t.kind === 'after_sales_shop')

  return (
    <div className="min-w-0 overflow-hidden border-t border-slate-100 pt-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-800">后台任务进度</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            不用手动刷新网页，这里会自动更新。
          </p>
        </div>
      </div>

      <p className="mt-2 break-words text-xs font-medium leading-relaxed text-slate-700">
        {loading && !data
          ? '正在读取后台任务…'
          : data?.headline ?? '暂时读不到后台状态'}
      </p>

      {error ? <p className="mt-2 break-words text-xs text-red-600">{error}</p> : null}

      <div className="mt-2.5 max-h-[min(50vh,420px)] space-y-2 overflow-y-auto overflow-x-hidden pr-0.5">
        {mainTasks.map((task) => (
          <TaskProgressRow key={task.id} task={task} />
        ))}

        {shopTasks.length > 0 ? (
          <div className="min-w-0 space-y-2 border-t border-slate-100 pt-2">
            <p className="text-[11px] font-medium text-slate-500">各直播号售后积压</p>
            {shopTasks.map((task) => (
              <TaskProgressRow key={task.id} task={task} />
            ))}
          </div>
        ) : null}

        {!loading && mainTasks.length === 0 && !error ? (
          <p className="text-xs text-slate-400">当前没有可展示的任务</p>
        ) : null}
      </div>

      {data?.polledAt ? (
        <p className="mt-2 text-[11px] text-slate-400">
          最近刷新：
          {new Date(data.polledAt).toLocaleString('zh-CN', { hour12: false })}
        </p>
      ) : null}
    </div>
  )
}
