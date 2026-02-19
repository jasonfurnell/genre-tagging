import { useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Suggestion } from '@/schemas'

interface SuggestionCardProps {
  suggestion: Suggestion
  onCreatePlaylist: (suggestion: Suggestion) => void
  isCreating?: boolean
}

function artworkUrl(artist: string, title: string): string {
  return `/artwork/${encodeURIComponent(artist)}||${encodeURIComponent(title)}`
}

export function SuggestionCard({ suggestion, onCreatePlaylist, isCreating }: SuggestionCardProps) {
  const handleCreate = useCallback(() => {
    onCreatePlaylist(suggestion)
  }, [onCreatePlaylist, suggestion])

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-tight">{suggestion.name}</CardTitle>
          {suggestion.track_count != null && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              ~{suggestion.track_count} tracks
            </Badge>
          )}
        </div>
        {suggestion.rationale && (
          <p className="text-muted-foreground text-xs italic">{suggestion.rationale}</p>
        )}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <p className="text-muted-foreground text-xs">{suggestion.description}</p>

        {/* Sample tracks */}
        {suggestion.sample_tracks && suggestion.sample_tracks.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
              Sample tracks
            </p>
            <div className="flex flex-col gap-1">
              {suggestion.sample_tracks.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <img
                    src={artworkUrl(t.artist, t.title)}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded object-cover"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <span className="truncate text-xs">
                    {t.artist} — {t.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-auto flex gap-2 pt-2">
          <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create Playlist'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
