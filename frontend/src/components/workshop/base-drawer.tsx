import { Button } from '@/components/ui/button'
import type { TrackOption } from '@/schemas'

interface BaseDrawerProps {
  open: boolean
  track: TrackOption | null
  isPlaying: boolean
  currentTime: number
  duration: number
  onTogglePause: () => void
  onPrev: () => void
  onNext: () => void
  onExpand: () => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function BaseDrawer({
  open,
  track,
  isPlaying,
  currentTime,
  duration,
  onTogglePause,
  onPrev,
  onNext,
  onExpand,
}: BaseDrawerProps) {
  if (!open || !track) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-2">
      <div className="flex items-center gap-4">
        {/* Artwork + info */}
        <div className="flex items-center gap-3">
          <img
            src={`/api/artwork/small/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.title)}`}
            alt=""
            className="h-10 w-10 shrink-0 rounded object-cover"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{track.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{track.artist}</div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-xs" onClick={onPrev}>
            ⏮
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-xs" onClick={onTogglePause}>
            {isPlaying ? '⏸' : '▶'}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-xs" onClick={onNext}>
            ⏭
          </Button>
        </div>

        {/* Progress */}
        <div className="flex flex-1 items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{formatTime(currentTime)}</span>
          <div className="relative h-1 flex-1 rounded-full bg-muted">
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{formatTime(duration)}</span>
        </div>

        {/* Expand */}
        <Button variant="ghost" size="sm" className="text-xs" onClick={onExpand}>
          Expand
        </Button>
      </div>
    </div>
  )
}
