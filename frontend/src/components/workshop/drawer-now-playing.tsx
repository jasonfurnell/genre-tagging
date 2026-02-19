import { Button } from '@/components/ui/button'
import type { TrackOption } from '@/schemas'

interface DrawerNowPlayingProps {
  track: TrackOption | null
  isPlaying: boolean
  currentTime: number
  duration: number
  onTogglePause: () => void
  onPrev: () => void
  onNext: () => void
  onSeek: (time: number) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function DrawerNowPlaying({
  track,
  isPlaying,
  currentTime,
  duration,
  onTogglePause,
  onPrev,
  onNext,
  onSeek,
}: DrawerNowPlayingProps) {
  if (!track) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">No track playing</p>
      </div>
    )
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex flex-1 flex-col items-center gap-4 p-4">
      {/* Artwork */}
      <img
        src={`/api/artwork/big/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.title)}`}
        alt=""
        className="h-48 w-48 rounded-lg object-cover shadow-lg"
        onError={(e) => {
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />

      {/* Title & artist */}
      <div className="text-center">
        <div className="text-sm font-medium">{track.title}</div>
        <div className="text-xs text-muted-foreground">{track.artist}</div>
      </div>

      {/* Meta */}
      <div className="flex gap-3 text-[11px] text-muted-foreground">
        {track.bpm && <span>{Math.round(track.bpm)} BPM</span>}
        {track.key && <span>{track.key}</span>}
        {track.year && <span>{track.year}</span>}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onPrev}>
          ⏮
        </Button>
        <Button size="sm" onClick={onTogglePause} className="h-9 w-9 rounded-full p-0">
          {isPlaying ? '⏸' : '▶'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onNext}>
          ⏭
        </Button>
      </div>

      {/* Progress */}
      <div className="flex w-full items-center gap-2">
        <span className="text-[10px] text-muted-foreground">{formatTime(currentTime)}</span>
        <div
          className="relative h-1 flex-1 cursor-pointer rounded-full bg-muted"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pct = (e.clientX - rect.left) / rect.width
            onSeek(pct * duration)
          }}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">{formatTime(duration)}</span>
      </div>
    </div>
  )
}
