import React, { useEffect, useState } from 'react'
import { fetchDailyReportImageBlobUrl } from '../../lib/daily-report-image-url'

interface Props {
  publicUrl: string
  alt: string
  className?: string
  onClick?: () => void
}

export const DailyReportImageThumb: React.FC<Props> = ({
  publicUrl,
  alt,
  className,
  onClick,
}) => {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    setFailed(false)
    setSrc(null)
    void (async () => {
      const blobUrl = await fetchDailyReportImageBlobUrl(publicUrl)
      if (cancelled) {
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        return
      }
      if (!blobUrl) {
        setFailed(true)
        return
      }
      revoked = blobUrl
      setSrc(blobUrl)
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [publicUrl])

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-center text-[11px] text-slate-500 ${className ?? ''}`}
      >
        图片加载失败
        <br />
        请重新上传
      </div>
    )
  }

  if (!src) {
    return <div className={`animate-pulse bg-slate-100 ${className ?? ''}`} />
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block w-full overflow-hidden rounded-lg">
        <img src={src} alt={alt} className={className} />
      </button>
    )
  }

  return <img src={src} alt={alt} className={className} />
}
