import { Button } from '@/components/ui/button'
import { useAutosetStore } from '@/stores/autoset'
import type { Playlist, PhaseProfile } from '@/schemas'

interface AutosetFormProps {
  playlists: Playlist[]
  profiles: PhaseProfile[]
  isBuilding: boolean
  onBuild: () => void
  onStop: () => void
}

export function AutosetForm({
  playlists,
  profiles,
  isBuilding,
  onBuild,
  onStop,
}: AutosetFormProps) {
  const sourceType = useAutosetStore((s) => s.sourceType)
  const setSourceType = useAutosetStore((s) => s.setSourceType)
  const sourceId = useAutosetStore((s) => s.sourceId)
  const setSourceId = useAutosetStore((s) => s.setSourceId)
  const treeType = useAutosetStore((s) => s.treeType)
  const setTreeType = useAutosetStore((s) => s.setTreeType)
  const profileId = useAutosetStore((s) => s.profileId)
  const setProfileId = useAutosetStore((s) => s.setProfileId)

  const canBuild = sourceId !== '' && !isBuilding

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      {/* Source type + source */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-muted-foreground text-xs font-medium">Source</label>
        <select
          className="rounded border border-border bg-background px-2 py-1.5 text-xs"
          value={sourceType}
          onChange={(e) => {
            setSourceType(e.target.value as 'playlist' | 'tree_node')
            setSourceId('')
          }}
          disabled={isBuilding}
        >
          <option value="playlist">Playlist</option>
          <option value="tree_node">Tree Leaf</option>
        </select>

        {sourceType === 'tree_node' && (
          <select
            className="rounded border border-border bg-background px-2 py-1.5 text-xs"
            value={treeType}
            onChange={(e) => {
              setTreeType(e.target.value)
              setSourceId('')
            }}
            disabled={isBuilding}
          >
            <option value="collection">Collection</option>
            <option value="genre">Genre</option>
            <option value="scene">Scene</option>
          </select>
        )}

        {sourceType === 'playlist' ? (
          <select
            className="min-w-[200px] flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            disabled={isBuilding}
          >
            <option value="">Select a playlist...</option>
            {playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name} ({pl.track_ids.length} tracks)
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            placeholder="Enter tree node ID..."
            className="min-w-[200px] flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            disabled={isBuilding}
          />
        )}
      </div>

      {/* Phase profile + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-muted-foreground text-xs font-medium">Profile</label>
        <select
          className="rounded border border-border bg-background px-2 py-1.5 text-xs"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          disabled={isBuilding}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex gap-2">
          {isBuilding ? (
            <Button size="sm" variant="destructive" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={onBuild} disabled={!canBuild}>
              Generate Set
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
