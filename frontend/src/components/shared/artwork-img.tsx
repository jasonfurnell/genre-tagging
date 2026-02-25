/**
 * Shared artwork image component with automatic batch-loading.
 *
 * Drop-in replacement for raw <img> tags that construct artwork URLs.
 * Uses the useArtworkUrl hook which batches requests efficiently.
 */

import { cn } from '@/lib/utils'
import { useArtworkUrl } from '@/hooks/use-artwork'

interface ArtworkImgProps {
  artist: string
  title: string
  size?: 'small' | 'big'
  className?: string
  /** Fallback content when no artwork is available */
  fallback?: React.ReactNode
}

export function ArtworkImg({
  artist,
  title,
  size = 'small',
  className,
  fallback,
}: ArtworkImgProps) {
  const url = useArtworkUrl(artist, title, size)

  if (!url) {
    if (fallback) return <>{fallback}</>
    return (
      <div
        className={cn(
          'bg-muted flex shrink-0 items-center justify-center rounded text-xs text-muted-foreground',
          className ?? 'h-8 w-8',
        )}
      >
        ♪
      </div>
    )
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={cn('shrink-0 rounded object-cover', className ?? 'h-8 w-8')}
      onError={(e) => {
        ;(e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}
