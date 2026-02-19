import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { SourceBadge } from '@/components/shared'
import { usePlaylistsStore } from '@/stores/playlists'
import type { Playlist } from '@/schemas'

interface PlaylistSidebarProps {
  playlists: Playlist[] | undefined
  isLoading: boolean
}

export function PlaylistSidebar({ playlists, isLoading }: PlaylistSidebarProps) {
  const selectedId = usePlaylistsStore((s) => s.selectedPlaylistId)
  const setSelectedId = usePlaylistsStore((s) => s.setSelectedPlaylistId)

  if (isLoading) {
    return (
      <div className="flex w-[280px] shrink-0 flex-col gap-2 border-r border-border p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded" />
        ))}
      </div>
    )
  }

  if (!playlists || playlists.length === 0) {
    return (
      <div className="flex w-[280px] shrink-0 items-center justify-center border-r border-border p-3">
        <p className="text-muted-foreground text-sm">No playlists yet</p>
      </div>
    )
  }

  return (
    <ScrollArea className="w-[280px] shrink-0 border-r border-border">
      <div className="flex flex-col gap-1 p-2">
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`flex flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent ${
              selectedId === p.id ? 'bg-accent' : ''
            }`}
          >
            <span className="truncate text-sm font-medium">{p.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">{p.track_ids.length} tracks</span>
              <SourceBadge source={p.source} />
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  )
}
