import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import type { TrackRow } from '@/schemas'

type SortField = 'title' | 'artist' | 'bpm' | 'key' | 'year'
type SortDir = 'asc' | 'desc'

function artworkUrl(artist: string, title: string): string {
  return `/artwork/${encodeURIComponent(artist)}||${encodeURIComponent(title)}`
}

interface PlaylistTrackTableProps {
  tracks: TrackRow[]
  onRemoveTrack: (trackId: number) => void
}

export function PlaylistTrackTable({ tracks, onRemoveTrack }: PlaylistTrackTableProps) {
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortField(field)
        setSortDir('asc')
      }
    },
    [sortField],
  )

  const sortedTracks = useMemo(() => {
    if (!sortField) return tracks
    return [...tracks].sort((a, b) => {
      const av = a[sortField] ?? ''
      const bv = b[sortField] ?? ''
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [tracks, sortField, sortDir])

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  if (tracks.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">No tracks in this playlist</p>
    )
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-8 px-2 py-2"></th>
            <th className="cursor-pointer px-2 py-2" onClick={() => handleSort('title')}>
              Title{sortIndicator('title')}
            </th>
            <th className="cursor-pointer px-2 py-2" onClick={() => handleSort('artist')}>
              Artist{sortIndicator('artist')}
            </th>
            <th
              className="w-16 cursor-pointer px-2 py-2 text-right"
              onClick={() => handleSort('bpm')}
            >
              BPM{sortIndicator('bpm')}
            </th>
            <th className="w-14 cursor-pointer px-2 py-2" onClick={() => handleSort('key')}>
              Key{sortIndicator('key')}
            </th>
            <th
              className="w-14 cursor-pointer px-2 py-2 text-right"
              onClick={() => handleSort('year')}
            >
              Year{sortIndicator('year')}
            </th>
            <th className="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sortedTracks.map((t) => (
            <tr key={t.id} className="border-b border-border/50 hover:bg-accent/50">
              <td className="px-2 py-1.5">
                <img
                  src={artworkUrl(t.artist, t.title)}
                  alt=""
                  className="h-7 w-7 rounded object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              </td>
              <td className="max-w-[200px] truncate px-2 py-1.5">{t.title}</td>
              <td className="max-w-[160px] truncate px-2 py-1.5 text-muted-foreground">
                {t.artist}
              </td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{t.bpm ?? ''}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{t.key ?? ''}</td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{t.year ?? ''}</td>
              <td className="px-2 py-1.5">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onRemoveTrack(t.id)}
                >
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
