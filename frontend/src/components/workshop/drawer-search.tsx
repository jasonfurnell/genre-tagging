import { useState, useCallback, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTrackSearch } from '@/hooks/use-workshop'

interface DrawerSearchProps {
  onTrackDragStart: (
    e: React.DragEvent,
    trackId: number,
    sourceType: string,
    sourceId: string,
    treeType: string | null,
    name: string,
  ) => void
}

export function DrawerSearch({ onTrackDragStart }: DrawerSearchProps) {
  const [query, setQuery] = useState('')
  const search = useTrackSearch()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (value.trim().length >= 2) {
        debounceRef.current = setTimeout(() => {
          search.mutate(value.trim())
        }, 300)
      }
    },
    [search],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const tracks = search.data?.tracks ?? []

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search tracks by title or artist..."
        className="h-8 text-xs"
        autoFocus
      />

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-1">
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent active:cursor-grabbing"
              draggable
              onDragStart={(e) =>
                onTrackDragStart(
                  e,
                  track.id,
                  'adhoc',
                  `search-${track.id}`,
                  null,
                  `${track.artist ?? ''} — ${track.title ?? ''}`,
                )
              }
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{track.title ?? 'Unknown'}</div>
                <div className="truncate text-muted-foreground">{track.artist ?? 'Unknown'}</div>
              </div>
              <div className="shrink-0 text-right text-[10px] text-muted-foreground">
                {track.bpm ? `${Math.round(track.bpm)}` : ''}
                {track.key ? ` ${track.key}` : ''}
              </div>
            </div>
          ))}
          {query.length >= 2 && !search.isPending && tracks.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No results</p>
          )}
          {search.isPending && (
            <p className="py-4 text-center text-xs text-muted-foreground">Searching...</p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
