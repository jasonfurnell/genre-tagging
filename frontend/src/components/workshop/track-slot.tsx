import { memo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { camelotColor } from '@/lib/camelot'
import type { TrackOption } from '@/schemas'
import { WS, bpmToY } from '@/stores/workshop'

interface TrackSlotProps {
  track: TrackOption
  isSelected: boolean
  bpmOffset: number
  onClick: () => void
  isLoading?: boolean
}

export const TrackSlot = memo(function TrackSlot({
  track,
  isSelected,
  bpmOffset,
  onClick,
  isLoading,
}: TrackSlotProps) {
  const [imgError, setImgError] = useState(false)

  if (isLoading) {
    return (
      <div
        className="absolute left-1"
        style={{ top: bpmOffset - WS.IMG / 2, width: WS.IMG, height: WS.IMG }}
      >
        <Skeleton className="h-full w-full rounded" />
      </div>
    )
  }

  const bpm = track.bpm ?? 100
  const y = bpmToY(bpm)
  const keyColor = camelotColor(track.key)

  const artSrc = `/api/artwork/small/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.title)}`

  return (
    <button
      className={`absolute left-1 cursor-pointer overflow-hidden rounded transition-shadow ${
        isSelected ? 'z-10 ring-2 shadow-lg' : 'opacity-60 hover:opacity-90'
      }`}
      style={{
        top: y - WS.IMG / 2,
        width: WS.IMG,
        height: WS.IMG,
        ...(isSelected && keyColor
          ? { ringColor: keyColor, boxShadow: `0 0 8px ${keyColor}55` }
          : {}),
      }}
      onClick={onClick}
      title={`${track.artist} — ${track.title}\nBPM: ${track.bpm ?? '?'} | Key: ${track.key ?? '?'}`}
    >
      {!imgError ? (
        <img
          src={artSrc}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted text-[8px] text-muted-foreground">
          {track.artist.slice(0, 6)}
        </div>
      )}
    </button>
  )
})
