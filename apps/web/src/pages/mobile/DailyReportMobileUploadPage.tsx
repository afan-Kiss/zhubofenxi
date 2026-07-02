import React, { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  isValidReportDate,
  uploadDailyReportImageMobile,
} from '../../lib/daily-report-mobile-upload'

export const DailyReportMobileUploadPage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const reportDate = searchParams.get('date')?.trim() ?? ''
  const uploadToken = searchParams.get('token')?.trim() ?? ''
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadCount, setUploadCount] = useState(0)

  const linkValid = useMemo(
    () => isValidReportDate(reportDate) && uploadToken.length >= 16,
    [reportDate, uploadToken],
  )

  const handlePick = () => {
    if (!linkValid || uploading) return
    fileInputRef.current?.click()
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !linkValid || uploading) return
    setUploading(true)
    setError(null)
    setMessage(null)
    let success = 0
    try {
      for (const file of Array.from(files)) {
        await uploadDailyReportImageMobile({
          reportDate,
          uploadToken,
          file,
          caption,
        })
        success++
      }
      setUploadCount((prev) => prev + success)
      setMessage(`已成功上传 ${success} 张，可继续添加`)
      setCaption('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (!linkValid) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">上传链接无效</h1>
          <p className="mt-2 text-sm text-slate-600">
            请在电脑端日报页面重新打开「手机扫码上传」，使用最新二维码。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">发货前照片上传</h1>
        <p className="mt-1 text-sm text-slate-500">日报日期：{reportDate}</p>
        {uploadCount > 0 ? (
          <p className="mt-2 text-xs text-emerald-700">本次已上传 {uploadCount} 张</p>
        ) : null}

        <label className="mt-5 block text-sm font-medium text-slate-700">
          备注（可选）
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="例如：早场发货前"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base"
          />
        </label>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => void handleUpload(e.target.files)}
        />

        <button
          type="button"
          disabled={uploading}
          onClick={handlePick}
          className="mt-5 w-full rounded-xl bg-rose-600 px-4 py-3.5 text-base font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          {uploading ? '上传中…' : '拍照 / 选择图片'}
        </button>

        <p className="mt-3 text-center text-xs text-slate-500">
          支持 jpg / png / webp，单张不超过 10MB
        </p>

        {message ? (
          <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
      </div>
    </div>
  )
}
