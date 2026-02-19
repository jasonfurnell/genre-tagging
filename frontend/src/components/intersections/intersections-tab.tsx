import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Separator } from '@/components/ui/separator'
import { ChordControls } from './chord-controls'
import { ChordDiagram } from './chord-diagram'
import { ChordPopover } from './chord-popover'
import { IntersectionCards } from './intersection-cards'
import { useChordData } from '@/hooks/use-chord'
import { useSuggest } from '@/hooks/use-suggestions'
import { useIntersectionsStore } from '@/stores/intersections'
import type { ChordLineage, Suggestion } from '@/schemas'

interface PopoverState {
  lineage1: ChordLineage
  lineage2: ChordLineage
  sharedCount: number
  position: { x: number; y: number }
}

export function IntersectionsTab() {
  const treeType = useIntersectionsStore((s) => s.treeType)
  const threshold = useIntersectionsStore((s) => s.threshold)
  const maxLineages = useIntersectionsStore((s) => s.maxLineages)

  const { data, isLoading, isError, error } = useChordData(treeType, threshold, maxLineages)
  const suggest = useSuggest()

  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [cards, setCards] = useState<{
    suggestions: Suggestion[]
    title1: string
    title2: string
  } | null>(null)

  const handleRibbonClick = useCallback(
    (lineage1: ChordLineage, lineage2: ChordLineage, sharedCount: number, event: MouseEvent) => {
      setPopover({ lineage1, lineage2, sharedCount, position: { x: event.pageX, y: event.pageY } })
    },
    [],
  )

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleBrowse = useCallback((_l1: ChordLineage, _l2: ChordLineage) => {
    toast.info('Browse Shared Tracks will be available when the Tracks tab is migrated.')
  }, [])

  const handleGenerate = useCallback(
    (lineage1: ChordLineage, lineage2: ChordLineage) => {
      setCards({ suggestions: [], title1: lineage1.title, title2: lineage2.title })
      suggest.mutate(
        {
          mode: 'chord-intersection',
          lineage1_title: lineage1.title,
          lineage2_title: lineage2.title,
          lineage1_filters: lineage1.filters,
          lineage2_filters: lineage2.filters,
          num_suggestions: 3,
        },
        {
          onSuccess: (suggestions) => {
            setCards({ suggestions, title1: lineage1.title, title2: lineage2.title })
          },
          onError: (err) => {
            toast.error(`Suggestion failed: ${err.message}`)
            setCards(null)
          },
        },
      )
    },
    [suggest],
  )

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
      {/* Intersection suggestion cards (appear after Generate) */}
      {cards && (
        <>
          <IntersectionCards
            suggestions={cards.suggestions}
            title1={cards.title1}
            title2={cards.title2}
            isLoading={suggest.isPending}
          />
          <Separator />
        </>
      )}

      {/* Chord diagram section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Lineage DNA</h2>
          {isLoading && (
            <span className="text-xs text-muted-foreground">Loading lineage data...</span>
          )}
        </div>

        <ChordControls />

        <div className="mt-4">
          {isError && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {(error as Error)?.message || 'Failed to load chord data'}
            </p>
          )}

          {data && <ChordDiagram data={data} onRibbonClick={handleRibbonClick} />}

          {!isLoading && !isError && !data && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No tree built yet. Build a tree in the Trees tab first.
            </p>
          )}
        </div>
      </section>

      {/* Click popover */}
      {popover && (
        <ChordPopover
          lineage1={popover.lineage1}
          lineage2={popover.lineage2}
          sharedCount={popover.sharedCount}
          position={popover.position}
          onBrowse={handleBrowse}
          onGenerate={handleGenerate}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
