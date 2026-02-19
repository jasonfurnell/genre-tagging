import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface TrackArtworkProps {
  artist: string
  title: string
  className?: string
}

export function TrackArtwork({ artist, title, className }: TrackArtworkProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!artist || !title) return
    let cancelled = false
    fetch(`/api/artwork?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.cover_url) setSrc(data.cover_url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [artist, title])

  if (failed || !src) {
    return (
      <div
        className={cn(
          'bg-muted flex shrink-0 items-center justify-center rounded text-xs',
          className ?? 'h-10 w-10',
        )}
      >
        ♪
      </div>
    )
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn('shrink-0 rounded object-cover', className ?? 'h-10 w-10')}
      onError={() => setFailed(true)}
    />
  )
}
