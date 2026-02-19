import { Button } from '@/components/ui/button'
import type { SavedSetSummary } from '@/schemas'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

interface SetCardProps {
  set: SavedSetSummary
  isActive: boolean
  onLoad: (id: string) => void
  onExport: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
}

export function SetCard({ set, isActive, onLoad, onExport, onDelete }: SetCardProps) {
  return (
    <div
      className={`cursor-pointer rounded-lg border bg-card p-4 transition-colors hover:border-primary ${
        isActive ? 'border-primary' : 'border-border'
      }`}
      onClick={() => onLoad(set.id)}
    >
      <p className="truncate text-sm font-semibold">{set.name}</p>

      <div className="text-muted-foreground mt-1 flex gap-3 text-xs">
        <span>{set.track_count} tracks</span>
        <span>{formatDuration(set.duration_minutes)}</span>
        <span>{formatDate(set.updated_at)}</span>
      </div>

      <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => onLoad(set.id)}
        >
          Load
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => onExport(set.id, set.name)}
        >
          Export
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="ml-auto h-7 text-xs"
          onClick={() => onDelete(set.id, set.name)}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}
