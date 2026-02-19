import { cn } from '@/lib/utils'
import type { TreeType } from '@/schemas'

const TYPES: { id: TreeType; label: string }[] = [
  { id: 'collection', label: 'Collection' },
  { id: 'genre', label: 'Genre Tree' },
  { id: 'scene', label: 'Scene Tree' },
]

interface TreeTypeSelectorProps {
  activeType: TreeType
  onTypeChange: (type: TreeType) => void
}

export function TreeTypeSelector({ activeType, onTypeChange }: TreeTypeSelectorProps) {
  return (
    <div className="flex items-center justify-center gap-1 px-4 py-2">
      {TYPES.map((t) => (
        <button
          key={t.id}
          onClick={() => onTypeChange(t.id)}
          className={cn(
            'flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            activeType === t.id
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
