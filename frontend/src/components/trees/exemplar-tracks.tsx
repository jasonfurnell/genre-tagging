import type { ExemplarTrack } from '@/schemas'
import { TrackArtwork } from './track-artwork'
import { PreviewButton } from './preview-button'

interface ExemplarTracksProps {
  examples: ExemplarTrack[]
  maxVisible?: number
}

export function ExemplarTracks({ examples, maxVisible = 7 }: ExemplarTracksProps) {
  if (!examples || examples.length === 0) return null
  const visible = examples.slice(0, maxVisible)

  return (
    <div className="mt-2 space-y-1">
      <p className="text-primary text-[0.7rem] font-semibold uppercase tracking-wider">
        Exemplar Tracks
      </p>
      <div className="space-y-1">
        {visible.map((ex, i) => (
          <div
            key={`${ex.artist}-${ex.title}-${i}`}
            className="border-border/50 bg-card/50 flex items-center gap-2 rounded border px-2 py-1.5 transition-colors hover:border-primary/30 hover:bg-primary/5"
          >
            <TrackArtwork artist={ex.artist} title={ex.title} className="h-8 w-8" />
            <PreviewButton artist={ex.artist} title={ex.title} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{ex.title}</span>
            <span className="text-muted-foreground shrink-0 truncate text-xs">{ex.artist}</span>
            {ex.year && (
              <span className="text-muted-foreground shrink-0 text-[0.65rem]">{ex.year}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
