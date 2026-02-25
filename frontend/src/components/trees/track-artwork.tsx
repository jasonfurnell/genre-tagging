/**
 * Track artwork component for tree views.
 * Now delegates to the shared ArtworkImg component with batch-loading.
 */

import { ArtworkImg } from '@/components/shared/artwork-img'

interface TrackArtworkProps {
  artist: string
  title: string
  className?: string
}

export function TrackArtwork({ artist, title, className }: TrackArtworkProps) {
  return <ArtworkImg artist={artist} title={title} className={className ?? 'h-10 w-10'} />
}
