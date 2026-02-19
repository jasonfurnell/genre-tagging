import { useMemo } from 'react'
import { useTaggerStore } from '@/stores/tagger'

const MAX_GENRES = 8

export function GenreChart() {
  const genreCounts = useTaggerStore((s) => s.genreCounts)

  const sorted = useMemo(() => {
    return Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_GENRES)
  }, [genreCounts])

  const max = sorted[0]?.[1] ?? 1

  if (sorted.length === 0) return null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-0.5 py-2">
      {sorted.map(([genre, count]) => (
        <div key={genre} className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground w-28 truncate text-right">{genre}</span>
          <div className="bg-muted h-3.5 flex-1 rounded-sm">
            <div
              className="bg-primary h-full rounded-sm transition-all duration-300"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="text-muted-foreground w-6 tabular-nums">{count}</span>
        </div>
      ))}
    </div>
  )
}
