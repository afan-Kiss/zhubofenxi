import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import { usePageView } from '../../hooks/usePageView'

interface AuditSummary {
  todayLoginUsers: number
  todayLoginCount: number
  todayRefreshCount: number
  todayDownloadCount: number
  todayDashboardViews: number
  avgStaySeconds: number
  recentActiveUsers: string[]
}

interface OpLog {
  id: string
  username: string
  role: string
  action: string
  module: string
  description: string
  ip: string
  userAgent: string
  durationMs: number | null
  createdAt: string
}

interface PageViewRow {
  id: string
  username: string
  role: string
  page: string
  startedAt: string
  lastSeenAt: string
  durationSeconds: number
  ip: string
  userAgent: string
}

const ACTION_LABELS: Record<string, string> = {
  login_success: '登录成功',
  login_failed: '登录失败',
  logout: '退出',
  refresh_dashboard: '查看经营数据',
  export_order_start: '发起订单导出',
  export_order_start_response: '订单 start_export 响应',
  export_order_success: '订单导出成功',
  export_order_failed: '订单导出失败',
  change_own_password: '修改自己的密码',
  reset_user_password: '重置用户密码',
  live_export_start: '发起直播场次导出',
  live_export_watch: '轮询直播场次导出',
  live_export_success: '直播场次导出成功',
  live_export_failed: '直播场次导出失败',
  live_download_success: '直播场次下载成功',
  live_download_failed: '直播场次下载失败',
  settled_export_start: '发起已结算明细导出',
  settled_export_record_poll: '轮询已结算导出记录',
  settled_export_success: '已结算明细导出成功',
  settled_export_failed: '已结算明细导出失败',
  settled_download_url_success: '获取已结算下载地址',
  settled_download_success: '已结算明细下载成功',
  settled_download_failed: '已结算明细下载失败',
  pending_export_start: '发起待结算明细导出',
  pending_export_record_poll: '轮询待结算导出记录',
  pending_export_success: '待结算明细导出成功',
  pending_export_failed: '待结算明细导出失败',
  pending_download_url_success: '获取待结算下载地址',
  pending_download_success: '待结算明细下载成功',
  pending_download_failed: '待结算明细下载失败',
  download_batch_start: '开始批量下载',
  download_batch_success: '批量下载成功',
  download_batch_partial_success: '批量下载部分成功',
  download_batch_failed: '批量下载失败',
  download_task_step_update: '下载步骤更新',
  download_task_success: '单表下载成功',
  download_task_failed: '单表下载失败',
  trigger_download: '单表下载',
  save_cookie: '保存 Cookie',
  view_dashboard: '查看看板',
  data_validation_start: '数据校验开始',
  data_validation_success: '数据校验成功',
  data_validation_warning: '数据校验警告',
  data_validation_failed: '数据校验失败',
  analysis_blocked: '分析禁止汇报',
  analysis_preview_only: '分析仅预览',
  analysis_official_ready: '分析可正式汇报',
  scheduled_refresh_start: '自动同步开始',
  scheduled_refresh_success: '自动同步成功',
  scheduled_refresh_partial_success: '自动同步部分成功',
  scheduled_refresh_failed: '自动同步失败',
  scheduled_refresh_skipped: '错过自动同步',
  manual_refresh_start: '手动触发同步开始',
  manual_refresh_success: '手动触发同步成功',
  manual_refresh_partial_success: '手动触发同步部分成功',
  manual_refresh_failed: '手动触发同步失败',
  snapshot_saved: '保存看板快照',
  analysis_pipeline_start: '经营分析开始',
  analysis_pipeline_success: '经营分析成功',
  analysis_pipeline_failed: '经营分析失败',
  excel_parse_success: 'Excel 解析成功',
  excel_parse_failed: 'Excel 解析失败',
  field_mapping_failed: '字段识别失败',
  order_normalize_success: '订单标准化完成',
  order_dedup_success: '订单去重完成',
  order_attribution_success: '主播归属完成',
  settlement_reconcile_success: '结算匹配完成',
  business_analysis_success: '经营分析完成',
  dashboard_view_real_data: '查看看板真实数据',
  view_refresh_history: '查看同步历史',
  view_operation_logs: '查看日志',
}

function shortUa(ua: string): string {
  if (!ua || ua === '—') return '—'
  const m = ua.match(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/)
  return m ? m[0] : ua.slice(0, 24)
}

export const OperationLogsPanel: React.FC = () => {
  usePageView('operation_logs', '/admin')

  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [logs, setLogs] = useState<OpLog[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [pageViews, setPageViews] = useState<PageViewRow[]>([])
  const [pvTotal, setPvTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [logPage, setLogPage] = useState(1)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sum, logRes, pvRes] = await Promise.all([
        apiRequest<AuditSummary>('/api/audit/summary'),
        apiRequest<{ total: number; list: OpLog[] }>(
          `/api/audit/logs?page=${logPage}&pageSize=15&username=${encodeURIComponent(filterUser)}&action=${encodeURIComponent(filterAction)}`,
        ),
        apiRequest<{ total: number; list: PageViewRow[] }>(
          `/api/audit/page-views?page=1&pageSize=15`,
        ),
      ])
      setSummary(sum)
      setLogs(logRes.list)
      setLogsTotal(logRes.total)
      setPageViews(pvRes.list)
      setPvTotal(pvRes.total)
    } finally {
      setLoading(false)
    }
  }, [logPage, filterUser, filterAction])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">仅超级管理员可查看，敏感信息已脱敏。</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          重新加载
        </button>
      </div>

      {summary && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: '今日登录人数', value: summary.todayLoginUsers },
            { label: '今日登录次数', value: summary.todayLoginCount },
            { label: '今日同步次数', value: summary.todayRefreshCount },
            { label: '今日下载次数', value: summary.todayDownloadCount },
            { label: '今日访问看板', value: summary.todayDashboardViews },
            {
              label: '平均停留',
              value: `${Math.floor(summary.avgStaySeconds / 60)}分${summary.avgStaySeconds % 60}秒`,
            },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-rose-100 bg-white px-3 py-2 shadow-sm"
            >
              <p className="text-[10px] text-slate-500">{c.label}</p>
              <p className="text-lg font-semibold text-slate-900">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      <section className="rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">操作日志</h3>
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            placeholder="用户名"
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          />
          <input
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="操作 action"
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => {
              setLogPage(1)
              void load()
            }}
            className="rounded-full bg-slate-800 px-3 py-1 text-xs text-white"
          >
            筛选
          </button>
        </div>
        <div className="table-scroll max-h-[320px] overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[720px] text-[10px]">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="py-1 text-left">时间</th>
                <th className="text-left">用户</th>
                <th className="text-left">操作</th>
                <th className="text-left">描述</th>
                <th className="text-left">IP</th>
                <th className="text-left">耗时</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-50">
                  <td className="whitespace-nowrap py-1 pr-1">
                    {new Date(l.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td>{l.username}</td>
                  <td title={l.action}>{ACTION_LABELS[l.action] ?? l.action}</td>
                  <td className="max-w-[140px] truncate" title={l.description}>
                    {l.description}
                  </td>
                  <td>{l.ip}</td>
                  <td>{l.durationMs != null ? `${l.durationMs}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          共 {logsTotal} 条 · 第 {logPage} 页
          {logPage > 1 && (
            <button type="button" className="ml-2 text-rose-600" onClick={() => setLogPage((p) => p - 1)}>
              上一页
            </button>
          )}
          {logPage * 15 < logsTotal && (
            <button type="button" className="ml-2 text-rose-600" onClick={() => setLogPage((p) => p + 1)}>
              下一页
            </button>
          )}
        </p>
      </section>

      <section className="rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">页面停留记录</h3>
        <div className="table-scroll max-h-[240px] overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[560px] text-[10px]">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="py-1 text-left">用户</th>
                <th className="text-left">页面</th>
                <th className="text-left">进入</th>
                <th className="text-left">停留</th>
                <th className="text-left">浏览器</th>
              </tr>
            </thead>
            <tbody>
              {pageViews.map((p) => (
                <tr key={p.id} className="border-t border-slate-50">
                  <td>{p.username}</td>
                  <td>{p.page}</td>
                  <td className="whitespace-nowrap">
                    {new Date(p.startedAt).toLocaleString('zh-CN')}
                  </td>
                  <td>{p.durationSeconds}s</td>
                  <td className="max-w-[80px] truncate" title={p.userAgent}>
                    {shortUa(p.userAgent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">共 {pvTotal} 条</p>
      </section>
    </div>
  )
}
