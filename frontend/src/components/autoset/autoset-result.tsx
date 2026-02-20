import { Button } from '@/components/ui/button'
import { useAutosetStore } from '@/stores/autoset'
import { useUiStore } from '@/stores/ui'
import type { AutosetResult as AutosetResultType, AutosetAct, AutosetTrack } from '@/stores/autoset'

interface AutosetResultProps {
  result: AutosetResultType
}

export function AutosetResult({ result }: AutosetResultProps) {
  const resetBuildState = useAutosetStore((s) => s.resetBuildState)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const handleOpenWorkshop = () => {
    setActiveTab('sets')
  }

  const handleRegenerate = () => {
    resetBuildState()
  }

  // Group tracks by act
  const tracksByAct = new Map<number, AutosetTrack[]>()
  for (const track of result.ordered_tracks) {
    const list = tracksByAct.get(track.act_idx) ?? []
    list.push(track)
    tracksByAct.set(track.act_idx, list)
  }

  return (
    <div className="space-y-4">
      {/* Narrative */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold">Set Narrative</h3>
        <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-relaxed">
          {result.narrative}
        </p>
      </div>

      {/* Acts */}
      <div className="space-y-3">
        {result.acts.map((act, i) => (
          <ActCard key={i} act={act} actIdx={i} tracks={tracksByAct.get(i) ?? []} />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button size="sm" onClick={handleOpenWorkshop}>
          View in Sets
        </Button>
        <Button size="sm" variant="outline" onClick={handleRegenerate}>
          Regenerate
        </Button>
      </div>
    </div>
  )
}

function ActCard({ act, tracks }: { act: AutosetAct; actIdx: number; tracks: AutosetTrack[] }) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      style={{ borderLeftWidth: 4, borderLeftColor: act.color || '#888' }}
    >
      {/* Act header */}
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="text-sm font-semibold">{act.name}</span>
        <span className="text-muted-foreground text-[0.65rem]">
          {act.pct[0]}–{act.pct[1]}%
        </span>
        {act.direction && (
          <span className="text-muted-foreground text-[0.65rem]">{act.direction}</span>
        )}
        <span className="text-muted-foreground ml-auto text-xs">{tracks.length} tracks</span>
      </div>

      {/* Tracks */}
      {tracks.length > 0 && (
        <div className="border-t border-border/50 px-3 py-1">
          {tracks.map((track, ti) => (
            <div
              key={track.track_id}
              className="flex items-center gap-2 border-b border-border/20 py-1 text-xs last:border-b-0"
            >
              <span className="text-muted-foreground/60 w-5 text-right">{ti + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {track.artist} — {track.title}
              </span>
              <span className="text-muted-foreground whitespace-nowrap text-[0.65rem]">
                {track.bpm ? `${Math.round(track.bpm)} BPM` : ''}
                {track.key ? ` · ${track.key}` : ''}
                {track.mood ? ` · ${track.mood}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
