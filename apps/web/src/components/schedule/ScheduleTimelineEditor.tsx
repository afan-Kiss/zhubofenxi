import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Maximize2, Minus, Plus, ZoomIn, ZoomOut } from 'lucide-react'
import { resolveAnchorTheme } from '../../lib/anchor-theme'
import {
  clampScheduleInterval,
  formatScheduleDuration,
  SCHEDULE_DAY_MINUTES,
  SCHEDULE_MIN_DURATION_MINUTES,
  SCHEDULE_SNAP_MINUTES,
  scheduleMinutesToTime,
  scheduleTimeToMinutes,
  snapScheduleMinutes,
} from '../../lib/schedule-time'
import {
  buildTimelineTicks,
  clampTimelineViewStart,
  collectTimelineShops,
  contentXToMinutes,
  DEFAULT_TIMELINE_ZOOM_INDEX,
  fitTimelineToRows,
  minutesToContentX,
  resolveDefaultTimelineView,
  resolveTimelineShopKey,
  TIMELINE_SHOP_ORDER,
  TIMELINE_ZOOM_SPANS,
  timelineZoomLabel,
} from '../../lib/schedule-timeline-utils'

export interface ScheduleTimelineRow {
  anchorId?: string | null
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  source?: string
  enabled?: boolean
  note?: string | null
  /** 主播配置色；优先于 id/name hash */
  color?: string | null
  isOnLeave?: boolean
}

export interface ScheduleTimelineEditorProps {
  date: string
  rows: ScheduleTimelineRow[]
  selectedIndex: number | null
  /** 外部请求把选中块滚入视野（如表格点击）；点时间轴本身不要递增 */
  focusRequestKey?: number
  conflictRowIndexes: Set<number>
  conflictMessagesByRow: string[][]
  onSelectedIndexChange: (index: number | null) => void
  onRowTimeChange: (
    index: number,
    patch: {
      startTime?: string
      endTime?: string
    },
  ) => void
  /** 双击空白轨道新增；可选 */
  onAddAt?: (payload: {
    shopName: string
    startTime: string
    endTime: string
  }) => void
}

type DragMode = 'move' | 'resize-start' | 'resize-end'

interface DragState {
  index: number
  mode: DragMode
  pointerId: number
  originX: number
  originStart: number
  originEnd: number
  contentWidth: number
}

function sourceLabel(source?: string): string {
  if (source === 'manual') return '人工排班'
  if (source === 'virtual_template') return '系统模板补齐'
  return '默认排班'
}

function endMinutesOf(row: ScheduleTimelineRow): number | null {
  const raw = row.endTime === '23:59' ? '24:00' : row.endTime
  return scheduleTimeToMinutes(raw)
}

export const ScheduleTimelineEditor: React.FC<ScheduleTimelineEditorProps> = ({
  date,
  rows,
  selectedIndex,
  focusRequestKey = 0,
  conflictRowIndexes,
  conflictMessagesByRow,
  onSelectedIndexChange,
  onRowTimeChange,
  onAddAt,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(720)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_TIMELINE_ZOOM_INDEX)
  const [viewStart, setViewStart] = useState(8 * 60)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoverTip, setHoverTip] = useState<{
    index: number
    x: number
    y: number
  } | null>(null)
  const initializedForDate = useRef<string | null>(null)
  const suppressClickRef = useRef(false)
  const programmaticScrollRef = useRef(false)

  const viewSpan = TIMELINE_ZOOM_SPANS[zoomIndex] ?? TIMELINE_ZOOM_SPANS[0]!
  const contentWidth = Math.max(containerWidth, (SCHEDULE_DAY_MINUTES / viewSpan) * containerWidth)
  const shops = useMemo(() => collectTimelineShops(rows, TIMELINE_SHOP_ORDER), [rows])
  const ticks = useMemo(() => buildTimelineTicks(0, SCHEDULE_DAY_MINUTES), [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setContainerWidth(Math.max(320, el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (initializedForDate.current === date) return
    const next = resolveDefaultTimelineView(rows)
    programmaticScrollRef.current = true
    setZoomIndex(next.zoomIndex)
    setViewStart(next.viewStart)
    initializedForDate.current = date
  }, [date, rows])

  const syncScrollFromViewStart = useCallback(
    (start: number, span: number, width: number) => {
      const el = scrollRef.current
      if (!el || width <= 0) return
      const cw = Math.max(el.clientWidth, (SCHEDULE_DAY_MINUTES / span) * el.clientWidth)
      el.scrollLeft = (clampTimelineViewStart(start, span) / SCHEDULE_DAY_MINUTES) * cw
    },
    [],
  )

  useLayoutEffect(() => {
    if (!programmaticScrollRef.current) return
    programmaticScrollRef.current = false
    syncScrollFromViewStart(viewStart, viewSpan, contentWidth)
  }, [viewStart, viewSpan, contentWidth, syncScrollFromViewStart])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el || contentWidth <= 0) return
    const nextStart = (el.scrollLeft / contentWidth) * SCHEDULE_DAY_MINUTES
    setViewStart(clampTimelineViewStart(nextStart, viewSpan))
  }

  const applyZoom = useCallback(
    (nextIndex: number, anchorClientX?: number) => {
      const clamped = Math.min(TIMELINE_ZOOM_SPANS.length - 1, Math.max(0, nextIndex))
      const el = scrollRef.current
      const nextSpan = TIMELINE_ZOOM_SPANS[clamped]!
      if (!el) {
        programmaticScrollRef.current = true
        setZoomIndex(clamped)
        setViewStart((s) => clampTimelineViewStart(s, nextSpan))
        return
      }
      const rect = el.getBoundingClientRect()
      const localX =
        anchorClientX != null ? Math.min(rect.width, Math.max(0, anchorClientX - rect.left)) : rect.width / 2
      const ratio = rect.width > 0 ? localX / rect.width : 0.5
      const anchorMin = viewStart + ratio * viewSpan
      const nextStart = clampTimelineViewStart(anchorMin - ratio * nextSpan, nextSpan)
      programmaticScrollRef.current = true
      setZoomIndex(clamped)
      setViewStart(nextStart)
    },
    [viewStart, viewSpan],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY < 0) applyZoom(zoomIndex + 1, e.clientX)
      else if (e.deltaY > 0) applyZoom(zoomIndex - 1, e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom, zoomIndex])

  const showFullDay = () => {
    programmaticScrollRef.current = true
    setZoomIndex(0)
    setViewStart(0)
  }

  const fitSchedules = () => {
    const fit = fitTimelineToRows(rows, 45)
    if (!fit) {
      showFullDay()
      return
    }
    programmaticScrollRef.current = true
    setZoomIndex(fit.zoomIndex)
    setViewStart(fit.viewStart)
  }

  const ensureBlockVisible = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return
      const start = scheduleTimeToMinutes(row.startTime)
      const end = endMinutesOf(row)
      if (start == null || end == null) return
      const pad = Math.min(30, Math.floor(viewSpan * 0.05))
      const viewEnd = viewStart + viewSpan
      // 已在视野内则不滚动，避免点选跳动
      if (start >= viewStart + pad && end <= viewEnd - pad) return
      const mid = (start + end) / 2
      const nextStart = clampTimelineViewStart(mid - viewSpan / 2, viewSpan)
      if (nextStart === viewStart) return
      programmaticScrollRef.current = true
      setViewStart(nextStart)
    },
    [rows, viewSpan, viewStart],
  )

  useEffect(() => {
    if (selectedIndex == null) return
    if (focusRequestKey <= 0) return
    ensureBlockVisible(selectedIndex)
  }, [focusRequestKey]) // eslint-disable-line react-hooks/exhaustive-deps -- 仅外部请求时滚动

  const commitInterval = useCallback(
    (index: number, startMin: number, endMin: number) => {
      const snappedStart = snapScheduleMinutes(startMin)
      const snappedEnd = snapScheduleMinutes(endMin)
      const { start, end } = clampScheduleInterval(snappedStart, snappedEnd)
      onRowTimeChange(index, {
        startTime: scheduleMinutesToTime(start),
        endTime: scheduleMinutesToTime(end),
      })
    },
    [onRowTimeChange],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      setDrag((current) => {
        if (!current || e.pointerId !== current.pointerId) return current
        const pxDelta = e.clientX - current.originX
        const minDelta = (pxDelta / current.contentWidth) * SCHEDULE_DAY_MINUTES
        const duration = current.originEnd - current.originStart

        if (current.mode === 'move') {
          let start = snapScheduleMinutes(current.originStart + minDelta)
          let end = start + duration
          if (end > SCHEDULE_DAY_MINUTES) {
            end = SCHEDULE_DAY_MINUTES
            start = Math.max(0, end - duration)
          }
          if (start < 0) {
            start = 0
            end = Math.min(SCHEDULE_DAY_MINUTES, duration)
          }
          commitInterval(current.index, start, end)
        } else if (current.mode === 'resize-start') {
          let start = snapScheduleMinutes(current.originStart + minDelta)
          start = Math.min(start, current.originEnd - SCHEDULE_MIN_DURATION_MINUTES)
          start = Math.max(0, start)
          commitInterval(current.index, start, current.originEnd)
        } else {
          let end = snapScheduleMinutes(current.originEnd + minDelta)
          end = Math.max(end, current.originStart + SCHEDULE_MIN_DURATION_MINUTES)
          end = Math.min(SCHEDULE_DAY_MINUTES, end)
          commitInterval(current.index, current.originStart, end)
        }
        suppressClickRef.current = true
        return current
      })
    },
    [commitInterval],
  )

  const endDrag = useCallback((e: PointerEvent) => {
    setDrag((current) => {
      if (!current || e.pointerId !== current.pointerId) return current
      try {
        ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
      } catch {
        // ignore
      }
      return null
    })
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }, [])

  useEffect(() => {
    if (!drag) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [drag, onPointerMove, endDrag])

  const beginDrag = (
    e: React.PointerEvent,
    index: number,
    mode: DragMode,
    start: number,
    end: number,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    onSelectedIndexChange(index)
    setDrag({
      index,
      mode,
      pointerId: e.pointerId,
      originX: e.clientX,
      originStart: start,
      originEnd: end,
      contentWidth,
    })
  }

  const statusLabel = useMemo(() => {
    const index = selectedIndex
    if (index == null || !rows[index]) {
      return '点击时间块查看时段；拖动中间移动，拖左右边调整起止'
    }
    const row = rows[index]!
    const start = scheduleTimeToMinutes(row.startTime)
    const end = endMinutesOf(row)
    if (start == null || end == null) {
      return `${row.anchorName || '未选主播'} · 时段待完善`
    }
    return `${row.anchorName || '未选主播'}  ${row.startTime}–${row.endTime} · ${formatScheduleDuration(start, end)}`
  }, [selectedIndex, rows])

  const handleBlockKeyDown = (e: React.KeyboardEvent, index: number, start: number, end: number) => {
    const step = e.shiftKey ? 30 : SCHEDULE_SNAP_MINUTES
    if (e.key === 'Escape') {
      onSelectedIndexChange(null)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const dir = e.key === 'ArrowLeft' ? -step : step
      const duration = end - start
      let nextStart = snapScheduleMinutes(start + dir)
      let nextEnd = nextStart + duration
      if (nextEnd > SCHEDULE_DAY_MINUTES) {
        nextEnd = SCHEDULE_DAY_MINUTES
        nextStart = nextEnd - duration
      }
      if (nextStart < 0) {
        nextStart = 0
        nextEnd = duration
      }
      commitInterval(index, nextStart, nextEnd)
    }
  }

  const handleTrackDoubleClick = (shop: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!onAddAt) return
    const target = e.target as HTMLElement
    if (target.closest('[data-timeline-block]')) return
    const track = e.currentTarget
    const rect = track.getBoundingClientRect()
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const x = e.clientX - rect.left + scrollLeft
    const start = snapScheduleMinutes(contentXToMinutes(x, contentWidth))
    const end = Math.min(SCHEDULE_DAY_MINUTES, start + 4 * 60 + 30)
    if (end - start < SCHEDULE_MIN_DURATION_MINUTES) return
    onAddAt({
      shopName: shop,
      startTime: scheduleMinutesToTime(start),
      endTime: scheduleMinutesToTime(end),
    })
  }

  const visibleTicks = useMemo(() => {
    const { major } = (() => {
      if (viewSpan >= 1200) return { major: 120 }
      if (viewSpan >= 720) return { major: 60 }
      if (viewSpan >= 360) return { major: 30 }
      return { major: 15 }
    })()
    return ticks.filter((t) => t.minute % major === 0 || t.minute === SCHEDULE_DAY_MINUTES)
  }, [ticks, viewSpan])

  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      data-testid="schedule-timeline-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onSelectedIndexChange(null)
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">直播排班时间轴</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {date} · {timelineZoomLabel(viewSpan)} · 滚轮缩放，拖动时间块调整时段
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label="缩小时间轴"
            onClick={() => applyZoom(zoomIndex - 1)}
            disabled={zoomIndex <= 0}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40"
          >
            <Minus size={12} />
            缩小
          </button>
          <button
            type="button"
            aria-label="放大时间轴"
            onClick={() => applyZoom(zoomIndex + 1)}
            disabled={zoomIndex >= TIMELINE_ZOOM_SPANS.length - 1}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40"
          >
            <Plus size={12} />
            放大
          </button>
          <button
            type="button"
            aria-label="按当日排班自动缩放视野"
            title="按当天最早到最晚的排班，自动缩放并滚动时间轴，让全部时间块都落在视野里"
            onClick={fitSchedules}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <ZoomIn size={12} />
            看全排班
          </button>
          <button
            type="button"
            aria-label="显示全天时间轴"
            title="把时间轴恢复为 00:00–24:00 全天视图"
            onClick={showFullDay}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Maximize2 size={12} />
            显示全天
          </button>
        </div>
      </div>

      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
        <span className="font-medium text-slate-500">当前时段</span>
        <span className="ml-2 tabular-nums text-slate-800">{statusLabel}</span>
      </div>

      <div className="flex min-w-0">
        <div className="w-28 shrink-0 border-r border-slate-100 bg-slate-50/80 sm:w-36">
          <div className="h-8 border-b border-slate-100 px-2 text-[11px] leading-8 text-slate-400">
            店铺 / 直播间
          </div>
          {shops.map((shop) => (
            <div
              key={shop}
              className="flex h-14 items-center border-b border-slate-100 px-2 text-xs font-medium text-slate-700"
              title={shop}
            >
              <span className="line-clamp-2">{shop}</span>
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
          onScroll={handleScroll}
        >
          <div ref={contentRef} className="relative" style={{ width: contentWidth }}>
            <div className="relative h-8 border-b border-slate-100 bg-slate-50/50">
              {visibleTicks.map((tick) => {
                const left = minutesToContentX(tick.minute, contentWidth)
                return (
                  <div
                    key={`tick-${tick.minute}`}
                    className="absolute top-0 h-full"
                    style={{ left }}
                  >
                    <div
                      className={`h-full border-l ${
                        tick.major ? 'border-slate-300' : 'border-slate-200'
                      }`}
                    />
                    {tick.label ? (
                      <span className="absolute left-1 top-1.5 whitespace-nowrap text-[10px] tabular-nums text-slate-500">
                        {tick.label}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {shops.map((shop) => (
              <div
                key={shop}
                className="relative h-14 border-b border-slate-100 bg-white"
                onDoubleClick={(e) => handleTrackDoubleClick(shop, e)}
                title={onAddAt ? '双击空白处新增排班' : undefined}
              >
                {visibleTicks.map((tick) => (
                  <div
                    key={`${shop}-grid-${tick.minute}`}
                    className={`absolute inset-y-0 border-l ${
                      tick.major ? 'border-slate-200/80' : 'border-slate-100'
                    }`}
                    style={{ left: minutesToContentX(tick.minute, contentWidth) }}
                  />
                ))}

                {rows.map((row, index) => {
                  if (resolveTimelineShopKey(row) !== shop) return null
                  if (row.enabled === false) return null
                  const start = scheduleTimeToMinutes(row.startTime)
                  const end = endMinutesOf(row)
                  if (start == null || end == null || end <= start) return null
                  const left = minutesToContentX(start, contentWidth)
                  const width = Math.max(8, minutesToContentX(end, contentWidth) - left)
                  const theme = resolveAnchorTheme({
                    id: row.anchorId,
                    name: row.anchorName,
                    color: row.color,
                  })
                  const selected = selectedIndex === index
                  const conflict = conflictRowIndexes.has(index)
                  const narrow = width < 88
                  const conflicts = conflictMessagesByRow[index] ?? []
                  const fill = `${theme.main}33`
                  const selectedRing = conflict ? undefined : `0 0 0 2px ${theme.main}`

                  return (
                    <div
                      key={`block-${index}`}
                      data-timeline-block
                      role="button"
                      tabIndex={0}
                      aria-label={`${row.anchorName} ${row.startTime}至${row.endTime}`}
                      className={`absolute top-1.5 z-10 flex h-11 select-none items-stretch overflow-hidden rounded-md border text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                        conflict
                          ? 'border-rose-400 shadow-[0_0_0_1px_rgba(244,63,94,0.25)]'
                          : selected
                            ? 'shadow-sm'
                            : 'border-transparent shadow-sm'
                      }`}
                      style={{
                        left,
                        width,
                        backgroundColor: fill,
                        borderColor: conflict ? undefined : theme.main,
                        color: theme.text,
                        boxShadow: selected && !conflict ? selectedRing : undefined,
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (suppressClickRef.current) return
                        onSelectedIndexChange(index)
                      }}
                      onKeyDown={(e) => handleBlockKeyDown(e, index, start, end)}
                      onPointerEnter={(e) => {
                        if (drag) return
                        setHoverTip({ index, x: e.clientX, y: e.clientY })
                      }}
                      onPointerMove={(e) => {
                        if (drag) return
                        setHoverTip({ index, x: e.clientX, y: e.clientY })
                      }}
                      onPointerLeave={() => {
                        if (!drag) setHoverTip(null)
                      }}
                    >
                      <div
                        className="w-2 shrink-0 cursor-ew-resize hover:brightness-95"
                        style={{ backgroundColor: theme.main }}
                        onPointerDown={(e) => beginDrag(e, index, 'resize-start', start, end)}
                        aria-hidden
                      />
                      <div
                        className="relative min-w-0 flex-1 cursor-grab px-1.5 py-1 active:cursor-grabbing"
                        onPointerDown={(e) => beginDrag(e, index, 'move', start, end)}
                      >
                        <div className="truncate text-[11px] font-semibold leading-tight">
                          {row.anchorName || '未选主播'}
                          {row.isOnLeave ? (
                            <span className="ml-1 font-bold text-red-600">休假</span>
                          ) : null}
                        </div>
                        {!narrow ? (
                          <div className="truncate text-[10px] leading-tight opacity-80">
                            {row.startTime}–{row.endTime}
                          </div>
                        ) : null}
                        {!narrow && width > 120 ? (
                          <div className="truncate text-[9px] leading-tight opacity-60">
                            {sourceLabel(row.source)}
                          </div>
                        ) : null}
                        {conflict ? (
                          <span className="absolute right-0.5 top-0.5 text-rose-600">
                            <AlertTriangle size={11} />
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="w-2 shrink-0 cursor-ew-resize hover:brightness-95"
                        style={{ backgroundColor: theme.main }}
                        onPointerDown={(e) => beginDrag(e, index, 'resize-end', start, end)}
                        aria-hidden
                      />
                      {conflicts.length > 0 ? (
                        <span className="sr-only">{conflicts.join('；')}</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hoverTip && !drag && rows[hoverTip.index] ? (
        <TimelineHoverCard
          row={rows[hoverTip.index]!}
          conflicts={conflictMessagesByRow[hoverTip.index] ?? []}
          x={hoverTip.x}
          y={hoverTip.y}
        />
      ) : null}

      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
        <ZoomOut size={11} />
        鼠标位于时间轴上时滚轮缩放；左右把手调整起止时间
      </div>
    </div>
  )
}

function TimelineHoverCard({
  row,
  conflicts,
  x,
  y,
}: {
  row: ScheduleTimelineRow
  conflicts: string[]
  x: number
  y: number
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x + 12, top: y + 12 })
  const start = scheduleTimeToMinutes(row.startTime)
  const end = endMinutesOf(row)
  const duration =
    start != null && end != null ? formatScheduleDuration(start, end) : '—'

  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x + 12
    let top = y + 12
    // 右侧不够则翻到指针左侧
    if (left + rect.width > vw - pad) left = x - rect.width - 12
    // 下方不够则翻到指针上方
    if (top + rect.height > vh - pad) top = y - rect.height - 12
    left = Math.min(vw - rect.width - pad, Math.max(pad, left))
    top = Math.min(vh - rect.height - pad, Math.max(pad, top))
    setPos({ left, top })
  }, [x, y, row.anchorName, row.startTime, row.endTime, row.note, conflicts.length])

  // Portal 到 body，避免被时间轴 overflow-hidden 裁切导致气泡显示不全
  return createPortal(
    <div
      ref={cardRef}
      className="pointer-events-none fixed z-[200] w-52 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 shadow-lg"
      style={{ left: pos.left, top: pos.top }}
      role="tooltip"
    >
      <p className="font-semibold text-slate-900">{row.anchorName || '未选主播'}</p>
      <p className="mt-0.5 text-slate-500">{resolveTimelineShopKey(row)}</p>
      <p className="mt-1 tabular-nums">
        {row.startTime}–{row.endTime}
        <span className="text-slate-400"> · {duration}</span>
      </p>
      <p className="mt-0.5 text-slate-500">{sourceLabel(row.source)}</p>
      {row.note?.trim() ? <p className="mt-0.5 break-words text-slate-500">备注：{row.note}</p> : null}
      {conflicts.length > 0 ? (
        <p className="mt-1 break-words text-rose-600">{conflicts.join('；')}</p>
      ) : null}
    </div>,
    document.body,
  )
}
