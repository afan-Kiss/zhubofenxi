import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { apiRequest } from '../../lib/api'
import {
  buildDailyReportMobileUploadUrl,
  type DailyReportUploadTokenPayload,
} from '../../lib/daily-report-mobile-upload'

interface Props {
  open: boolean
  reportDate: string
  onClose: () => void
  onRefresh?: () => void | Promise<void>
}

export const DailyReportMobileUploadQr: React.FC<Props> = ({
  open,
  reportDate,
  onClose,
  onRefresh,
}) => {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [uploadUrl, setUploadUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const loadQr = useCallback(async () => {
    if (!reportDate) return
    setLoading(true)
    setError(null)
    try {
      const payload = await apiRequest<DailyReportUploadTokenPayload>(
        `/daily-report-images/upload-token?date=${encodeURIComponent(reportDate)}`,
      )
      const url = buildDailyReportMobileUploadUrl(reportDate, payload.token)
      const dataUrl = await QRCode.toDataURL(url, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
      setUploadUrl(url)
      setQrDataUrl(dataUrl)
      setExpiresAt(payload.expiresAt)
    } catch (e) {
      setQrDataUrl(null)
      setUploadUrl(null)
      setExpiresAt(null)
      setError(e instanceof Error ? e.message : '生成二维码失败')
    } finally {
      setLoading(false)
    }
  }, [reportDate])

  useEffect(() => {
    if (!open) {
      stopPolling()
      return
    }
    void loadQr()
    pollTimerRef.current = window.setInterval(() => {
      void onRefreshRef.current?.()
    }, 3000)
    return () => stopPolling()
  }, [open, loadQr, stopPolling])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/50 p-4"
      style={{ height: '100dvh', maxHeight: '100dvh' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-report-qr-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="daily-report-qr-title" className="text-base font-semibold text-slate-900">
              手机扫码上传
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              日报日期 {reportDate}，扫码后可直接拍照或选图上传
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center">
          {loading ? (
            <div className="flex h-[280px] w-[280px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
              生成二维码中…
            </div>
          ) : qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`扫码上传 ${reportDate} 发货前照片`}
              className="h-[280px] w-[280px] rounded-xl border border-slate-200"
            />
          ) : (
            <div className="flex h-[280px] w-[280px] items-center justify-center rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 text-center text-sm text-rose-700">
              {error ?? '二维码生成失败'}
            </div>
          )}
        </div>

        {expiresAt ? (
          <p className="mt-3 text-center text-[11px] text-slate-500">
            链接有效期至 {new Date(expiresAt).toLocaleString('zh-CN', { hour12: false })}
          </p>
        ) : null}

        {error && qrDataUrl ? null : error ? (
          <button
            type="button"
            onClick={() => void loadQr()}
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            重新生成
          </button>
        ) : null}

        {uploadUrl ? (
          <p className="mt-3 break-all text-center text-[10px] text-slate-400">{uploadUrl}</p>
        ) : null}

        <p className="mt-3 text-center text-xs text-slate-500">
          上传成功后电脑端会自动刷新列表；关闭窗口不影响手机继续上传
        </p>
      </div>
    </div>,
    document.body,
  )
}
