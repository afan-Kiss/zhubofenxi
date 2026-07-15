import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ImageIcon, Loader2, MessageSquareWarning, RefreshCw, Search } from 'lucide-react'
import {
  fetchCsChatSessions,
  formatChatTime,
  syncCsChatSessions,
  type CsChatListPayload,
  type CsChatSessionView,
} from '../../lib/refund-analysis'
import { CsChatSessionDrawer } from '../../components/refund-analysis/CsChatSessionDrawer'
import {
  closeCsChatImageSessionBeacon,
  ensureCsChatImageSession,
} from '../../components/refund-analysis/CsChatImage'

const PAGE_SIZE = 40

export const RefundAnalysisPage: React.FC = () => {
  const [shop, setShop] = useState('')
  const [keyword, setKeyword] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [refundOnly, setRefundOnly] = useState(false)
  const [hasImage, setHasImage] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncMsg, setSyncMsg] = useState('')
  const [payload, setPayload] = useState<CsChatListPayload | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [preferLive, setPreferLive] = useState(false)

  useEffect(() => {
    ensureCsChatImageSession()
    return () => closeCsChatImageSessionBeacon()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchCsChatSessions({
        shop: shop || undefined,
        keyword: keyword || undefined,
        refundOnly,
        hasImage,
        limit: PAGE_SIZE,
        offset,
      })
      setPayload(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载会话失败')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [shop, keyword, refundOnly, hasImage, offset])

  useEffect(() => {
    void load()
  }, [load])

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg('')
    setError('')
    try {
      const result = await syncCsChatSessions({ days: 60, preferLive })
      setSyncMsg(
        `${result.message}（会话 ${result.sessionCount} / 消息 ${result.messageCount}）`,
      )
      setOffset(0)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const shops = payload?.shops ?? []
  const items = payload?.items ?? []
  const total = payload?.total ?? 0
  const pageLabel = useMemo(() => {
    if (!total) return '0'
    const from = offset + 1
    const to = Math.min(offset + items.length, total)
    return `${from}-${to} / ${total}`
  }, [offset, items.length, total])

  return (
    <div className="space-y-4" data-testid="refund-analysis-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <MessageSquareWarning className="h-5 w-5 text-rose-500" />
            退款分析
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            查看四店客服会话，便于结合退款情况排查沟通记录。图片可直接预览。
          </p>
          {payload?.meta.lastSyncedAt ? (
            <p className="mt-1 text-[11px] text-slate-400">
              最近同步：
              {formatChatTime(Date.parse(payload.meta.lastSyncedAt))}
              {payload.meta.source ? ` · ${payload.meta.source.slice(0, 80)}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={preferLive}
              onChange={(e) => setPreferLive(e.target.checked)}
              className="rounded border-slate-300"
            />
            在线拉取近 60 天
          </label>
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? '同步中…' : '同步会话'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <select
          value={shop}
          onChange={(e) => {
            setShop(e.target.value)
            setOffset(0)
          }}
          className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm"
        >
          <option value="">全部店铺</option>
          {shops.map((s) => (
            <option key={s.shopTitle} value={s.shopTitle}>
              {s.shopTitle}（{s.sessionCount}）
            </option>
          ))}
        </select>

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setKeyword(keywordInput.trim())
                setOffset(0)
              }
            }}
            placeholder="搜买家昵称 / 消息摘要"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm"
          />
        </div>
        <button
          type="button"
          className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          onClick={() => {
            setKeyword(keywordInput.trim())
            setOffset(0)
          }}
        >
          搜索
        </button>

        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={refundOnly}
            onChange={(e) => {
              setRefundOnly(e.target.checked)
              setOffset(0)
            }}
          />
          仅看含退款相关
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={hasImage}
            onChange={(e) => {
              setHasImage(e.target.checked)
              setOffset(0)
            }}
          />
          含图片
        </label>
      </div>

      {syncMsg ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {syncMsg}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <span>会话列表 · {pageLabel}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset <= 0 || loading}
              className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
              onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total || loading}
              className="rounded-lg border border-slate-200 px-2 py-1 disabled:opacity-40"
              onClick={() => setOffset((v) => v + PAGE_SIZE)}
            >
              下一页
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : null}

        {!loading && !items.length ? (
          <div className="px-4 py-12 text-center text-sm text-slate-400">
            暂无会话。请点击右上角「同步会话」导入桌面导出档案，或勾选「在线拉取近 60 天」。
          </div>
        ) : null}

        <ul className="divide-y divide-slate-50">
          {items.map((row: CsChatSessionView) => (
            <li key={row.id}>
              <button
                type="button"
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-rose-50/40"
                onClick={() => setActiveSessionId(row.id)}
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500">
                  {row.hasImage ? <ImageIcon className="h-4 w-4" /> : <MessageSquareWarning className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {row.buyerNick || '(未知名用户)'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                      {row.shopTitle}
                    </span>
                    {row.refundMention ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        含退款
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {row.lastMessageText || '（无摘要）'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {formatChatTime(row.lastMessageAt || row.modifyTime)} · {row.messageCount} 条
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <CsChatSessionDrawer
        open={Boolean(activeSessionId)}
        sessionId={activeSessionId}
        onClose={() => setActiveSessionId(null)}
      />
    </div>
  )
}
