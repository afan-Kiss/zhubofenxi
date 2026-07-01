import React, { useCallback, useEffect, useRef, useState } from 'react'
import { API_PREFIX, apiRequest } from '../../lib/api'
import { DailyReportImageThumb } from './DailyReportImageThumb'
import { fetchDailyReportImageBlobUrl } from '../../lib/daily-report-image-url'

export interface DailyReportImageItem {
  id: string
  reportDate: string
  publicUrl: string
  originalName: string
  mimeType: string
  size: number
  caption: string | null
  sortOrder: number
  uploadedBy: string | null
  createdAt: string
}

interface Props {
  reportDate: string
  onImagesChange?: (images: DailyReportImageItem[]) => void
}

export const DailyReportShipmentPhotos: React.FC<Props> = ({ reportDate, onImagesChange }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<DailyReportImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [captionDraft, setCaptionDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const lastSyncedIdsRef = useRef('')

  const syncImages = useCallback(
    (next: DailyReportImageItem[]) => {
      setImages(next)
      const ids = next.map((item) => item.id).join(',')
      if (ids === lastSyncedIdsRef.current) return
      lastSyncedIdsRef.current = ids
      onImagesChange?.(next)
    },
    [onImagesChange],
  )

  const loadImages = useCallback(async () => {
    if (!reportDate) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest<{ images: DailyReportImageItem[] }>(
        `/daily-report-images?date=${encodeURIComponent(reportDate)}`,
      )
      syncImages(data.images ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载发货前照片失败')
    } finally {
      setLoading(false)
    }
  }, [reportDate, syncImages])

  useEffect(() => {
    lastSyncedIdsRef.current = ''
    void loadImages()
  }, [loadImages])

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || uploading) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('reportDate', reportDate)
        form.append('caption', captionDraft)
        form.append('file', file)
        const res = await fetch(`${API_PREFIX}/daily-report-images`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        })
        const body = (await res.json()) as {
          ok?: boolean
          message?: string
          data?: { image: DailyReportImageItem }
        }
        if (!res.ok || body.ok === false) {
          throw new Error(body.message || '上传失败')
        }
      }
      setCaptionDraft('')
      await loadImages()
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除这张照片吗？')) return
    setError(null)
    try {
      await apiRequest(`/daily-report-images/${id}`, { method: 'DELETE' })
      await loadImages()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  const handleCaptionSave = async (id: string, caption: string) => {
    try {
      await apiRequest(`/daily-report-images/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ caption }),
      })
      await loadImages()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存备注失败')
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">发货前照片</p>
          <p className="mt-1 text-xs text-slate-500">
            这些照片会自动拼到昨日日报图片底部，发群时不用再单独补图。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            placeholder="备注（可选）"
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => void handleUpload(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading || loading}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            {uploading ? '上传中…' : '上传照片'}
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <p className="mt-2 text-xs text-slate-500">
        {loading ? '加载中…' : `已上传 ${images.length} 张（jpg / png / webp，单张 ≤ 10MB）`}
      </p>

      {images.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img) => (
            <div key={img.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2">
              <DailyReportImageThumb
                publicUrl={img.publicUrl}
                alt={img.originalName}
                className="aspect-square w-full object-cover"
                onClick={() => {
                  void fetchDailyReportImageBlobUrl(img.publicUrl).then((url) => {
                    if (url) setPreviewUrl(url)
                  })
                }}
              />
              <p className="mt-1 truncate text-[10px] text-slate-500">
                {new Date(img.createdAt).toLocaleString('zh-CN', { hour12: false })}
              </p>
              <input
                defaultValue={img.caption ?? ''}
                onBlur={(e) => {
                  if ((img.caption ?? '') !== e.target.value.trim()) {
                    void handleCaptionSave(img.id, e.target.value.trim())
                  }
                }}
                placeholder="备注"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
              />
              <button
                type="button"
                onClick={() => void handleDelete(img.id)}
                className="mt-1 text-[11px] text-rose-600 hover:underline"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {previewUrl ? (
        <div
          className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="预览"
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}
