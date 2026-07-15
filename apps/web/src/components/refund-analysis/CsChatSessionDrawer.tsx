import React, { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { BoardDrawerShell } from '../board/BoardDrawerShell'
import {
  fetchCsChatSessionDetail,
  formatChatTime,
  type CsChatMessageView,
  type CsChatSessionView,
} from '../../lib/refund-analysis'
import { CsChatImage, ensureCsChatImageSession } from './CsChatImage'

interface Props {
  open: boolean
  sessionId: string | null
  onClose: () => void
}

function MessageBubble({
  msg,
  onPreview,
}: {
  msg: CsChatMessageView
  onPreview: (url: string) => void
}) {
  const urls = msg.imageUrls.length ? msg.imageUrls : msg.thumbUrl ? [msg.thumbUrl] : []
  const showText =
    msg.text &&
    msg.contentType !== 'image' &&
    !/^【?图片消息】?$/.test(msg.text.trim()) &&
    msg.text.trim() !== '[图片]'

  return (
    <div className={`flex ${msg.isSellerSide ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          msg.isSellerSide
            ? 'rounded-br-md bg-rose-500 text-white'
            : 'rounded-bl-md border border-slate-100 bg-white text-slate-800'
        }`}
      >
        <div
          className={`mb-1 text-[11px] ${msg.isSellerSide ? 'text-rose-100' : 'text-slate-400'}`}
        >
          {msg.isSellerSide ? '客服' : msg.buyerNick || '买家'} · {formatChatTime(msg.createAt)}
        </div>
        {showText ? <div className="whitespace-pre-wrap break-words">{msg.text}</div> : null}
        {urls.length ? (
          <div className={`mt-1.5 flex flex-col gap-2 ${showText ? '' : ''}`}>
            {urls.map((url) => (
              <CsChatImage
                key={url}
                rawUrl={url}
                alt="会话图片"
                className={msg.isSellerSide ? 'ml-auto' : ''}
                onClick={() => onPreview(url)}
              />
            ))}
          </div>
        ) : null}
        {!showText && !urls.length ? (
          <div className={msg.isSellerSide ? 'text-rose-100' : 'text-slate-400'}>
            [{msg.contentType || '消息'}]
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const CsChatSessionDrawer: React.FC<Props> = ({ open, sessionId, onClose }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState<CsChatSessionView | null>(null)
  const [messages, setMessages] = useState<CsChatMessageView[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !sessionId) return
    ensureCsChatImageSession()
    let cancelled = false
    setLoading(true)
    setError('')
    setSession(null)
    setMessages([])
    void fetchCsChatSessionDetail(sessionId)
      .then((data) => {
        if (cancelled) return
        setSession(data.session)
        setMessages(data.messages)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载会话失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, sessionId])

  return (
    <>
      <BoardDrawerShell
        open={open}
        onClose={onClose}
        title={session?.buyerNick || '会话详情'}
        subtitle={
          session
            ? `${session.shopTitle} · ${session.messageCount} 条消息${
                session.refundMention ? ' · 含退款相关' : ''
              }`
            : '客服往来'
        }
        testId="cs-chat-session-drawer"
      >
        <div className="flex flex-col gap-2.5">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载消息…
            </div>
          ) : null}
          {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {!loading && !error && !messages.length ? (
            <div className="py-10 text-center text-sm text-slate-400">暂无消息</div>
          ) : null}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} onPreview={setPreviewUrl} />
          ))}
        </div>
      </BoardDrawerShell>

      {previewUrl ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-700"
            onClick={() => setPreviewUrl(null)}
            aria-label="关闭预览"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={`/api/refund-analysis/image-proxy?url=${encodeURIComponent(previewUrl)}`}
            alt="预览"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={() => setPreviewUrl(null)}
          />
        </div>
      ) : null}
    </>
  )
}
