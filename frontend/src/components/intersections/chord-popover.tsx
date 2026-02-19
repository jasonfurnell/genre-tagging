import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { ChordLineage } from '@/schemas'

interface ChordPopoverProps {
  lineage1: ChordLineage
  lineage2: ChordLineage
  sharedCount: number
  position: { x: number; y: number }
  onBrowse: (lineage1: ChordLineage, lineage2: ChordLineage) => void
  onGenerate: (lineage1: ChordLineage, lineage2: ChordLineage) => void
  onClose: () => void
}

export function ChordPopover({
  lineage1,
  lineage2,
  sharedCount,
  position,
  onBrowse,
  onGenerate,
  onClose,
}: ChordPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid the same click that opened the popover closing it
    const timer = setTimeout(() => document.addEventListener('click', handleClickOutside), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-lg border border-border bg-card p-3 shadow-lg"
      style={{ left: position.x + 10, top: position.y - 10 }}
    >
      <p className="text-sm font-medium">{lineage1.title}</p>
      <p className="text-sm text-muted-foreground">+ {lineage2.title}</p>
      <p className="my-2 text-xs text-muted-foreground">{sharedCount} shared tracks</p>
      <div className="flex flex-col gap-1.5">
        <Button
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() => {
            onBrowse(lineage1, lineage2)
            onClose()
          }}
        >
          Browse Shared Tracks
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 w-full text-xs"
          onClick={() => {
            onGenerate(lineage1, lineage2)
            onClose()
          }}
        >
          Generate Playlists
        </Button>
      </div>
    </div>
  )
}
