import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkshopSources } from '@/hooks/use-workshop'

interface DrawerBrowseProps {
  onSelectSource: (type: string, id: string, treeType: string | null, name: string) => void
}

export function DrawerBrowse({ onSelectSource }: DrawerBrowseProps) {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useWorkshopSources(search)

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search playlists & collections..."
        className="h-8 text-xs"
      />

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex flex-col gap-1 p-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-1">
            {/* Playlists */}
            {data?.playlists && data.playlists.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Playlists
                </div>
                {data.playlists.map((p) => (
                  <button
                    key={p.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                    onClick={() => onSelectSource('playlist', p.id, null, p.name)}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {p.track_count ?? 0}
                    </span>
                  </button>
                ))}
              </>
            )}

            {/* Collection leaves */}
            {data?.collection_leaves && data.collection_leaves.length > 0 && (
              <>
                <div className="mt-2 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Collection
                </div>
                {data.collection_leaves.map((leaf) => (
                  <button
                    key={leaf.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                    onClick={() =>
                      onSelectSource(
                        'tree_node',
                        leaf.id,
                        'collection',
                        leaf.name ?? leaf.title ?? leaf.id,
                      )
                    }
                  >
                    <span className="truncate">{leaf.name ?? leaf.title ?? leaf.id}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {leaf.track_count ?? 0}
                    </span>
                  </button>
                ))}
              </>
            )}

            {!data?.playlists?.length && !data?.collection_leaves?.length && (
              <p className="py-4 text-center text-xs text-muted-foreground">No sources found</p>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
