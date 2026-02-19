import { useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useSourceDetail } from '@/hooks/use-workshop'

interface DrawerDetailProps {
  sourceType: string | null
  sourceId: string | null
  treeType: string | null
  sourceName: string | null
  onBack: () => void
  onTrackDragStart: (
    e: React.DragEvent,
    trackId: number,
    sourceType: string,
    sourceId: string,
    treeType: string | null,
    name: string,
  ) => void
}

export function DrawerDetail({
  sourceType,
  sourceId,
  treeType,
  sourceName,
  onBack,
  onTrackDragStart,
}: DrawerDetailProps) {
  const { data, isLoading } = useSourceDetail(sourceType, sourceId, treeType)

  const handleDragStart = useCallback(
    (e: React.DragEvent, trackId: number) => {
      if (!sourceType || !sourceId) return
      onTrackDragStart(e, trackId, sourceType, sourceId, treeType, sourceName ?? 'Unknown')
    },
    [onTrackDragStart, sourceType, sourceId, treeType, sourceName],
  )

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onBack}>
          ← Back
        </Button>
        <span className="truncate text-sm font-medium">{sourceName ?? 'Source'}</span>
      </div>
      {data?.description && (
        <p className="px-1 text-[11px] text-muted-foreground">{data.description}</p>
      )}

      {/* Track list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex flex-col gap-1 p-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-1">
            {data?.tracks.map((track) => (
              <div
                key={track.id}
                className="flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent active:cursor-grabbing"
                draggable
                onDragStart={(e) => handleDragStart(e, track.id)}
              >
                <img
                  src={`/api/artwork/small/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.title)}`}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{track.title}</div>
                  <div className="truncate text-muted-foreground">{track.artist}</div>
                </div>
                <div className="shrink-0 text-right text-[10px] text-muted-foreground">
                  {track.bpm ? `${Math.round(track.bpm)}` : ''}
                  {track.key ? ` ${track.key}` : ''}
                </div>
              </div>
            ))}
            {(!data?.tracks || data.tracks.length === 0) && (
              <p className="py-4 text-center text-xs text-muted-foreground">No tracks</p>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
