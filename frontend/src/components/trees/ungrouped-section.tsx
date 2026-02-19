import { useState, useCallback, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useUngroupedTracks, useExpandUngrouped, treeKeys, progressUrl } from '@/hooks/use-trees'
import { useTreesStore } from '@/stores/trees'
import { subscribeSSE } from '@/lib/sse'
import { BuildProgress } from './build-progress'
import type { TreeType } from '@/schemas'

interface UngroupedSectionProps {
  type: TreeType
  ungroupedCount: number
}

export function UngroupedSection({ type, ungroupedCount }: UngroupedSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [expanding, setExpanding] = useState(false)
  const { data: ungrouped } = useUngroupedTracks(type, expanded)
  const expandUngrouped = useExpandUngrouped(type)
  const queryClient = useQueryClient()
  const isBuilding = useTreesStore((s) => s.isBuilding)
  const setIsBuilding = useTreesStore((s) => s.setIsBuilding)
  const resetBuildState = useTreesStore((s) => s.resetBuildState)
  const setBuildStartTime = useTreesStore((s) => s.setBuildStartTime)
  const setBuildPhase = useTreesStore((s) => s.setBuildPhase)
  const setBuildDetail = useTreesStore((s) => s.setBuildDetail)
  const setBuildPercent = useTreesStore((s) => s.setBuildPercent)
  const setBuildError = useTreesStore((s) => s.setBuildError)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const handleExpand = useCallback(() => {
    resetBuildState()
    setIsBuilding(true)
    setBuildStartTime(Date.now())
    setExpanding(true)

    expandUngrouped.mutate(undefined, {
      onSuccess: () => {
        unsubRef.current = subscribeSSE(
          progressUrl(type),
          (event) => {
            if (event.event === 'progress') {
              setBuildPhase(event.phase ?? '')
              setBuildDetail(event.detail ?? '')
              setBuildPercent(event.percent ?? 0)
            }
            if (event.event === 'error') {
              setBuildError(event.detail ?? 'Unknown error')
            }
          },
          () => {
            setIsBuilding(false)
            setExpanding(false)
            queryClient.invalidateQueries({ queryKey: treeKeys[type] })
          },
        )
      },
      onError: (err) => {
        setBuildError(err instanceof Error ? err.message : 'Expand failed')
        setIsBuilding(false)
        setExpanding(false)
      },
    })
  }, [
    type,
    expandUngrouped,
    queryClient,
    resetBuildState,
    setIsBuilding,
    setBuildStartTime,
    setBuildPhase,
    setBuildDetail,
    setBuildPercent,
    setBuildError,
  ])

  if (ungroupedCount === 0) return null

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▾' : '▸'} {ungroupedCount} Ungrouped Tracks
        </Button>
        {ungroupedCount >= 20 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExpand}
            disabled={isBuilding || expanding}
          >
            {expanding ? 'Creating Lineages...' : 'Create Lineages from Ungrouped'}
          </Button>
        )}
      </div>

      {expanding && <BuildProgress type={type} />}

      {expanded && ungrouped && !expanding && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-muted/30">
                <th className="px-2 py-1.5 text-left font-semibold">Artist</th>
                <th className="px-2 py-1.5 text-left font-semibold">Title</th>
                <th className="px-2 py-1.5 text-left font-semibold">Comment</th>
              </tr>
            </thead>
            <tbody>
              {ungrouped.tracks.map((track, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="px-2 py-1">{String(track.artist ?? '')}</td>
                  <td className="px-2 py-1">{String(track.title ?? '')}</td>
                  <td className="text-muted-foreground max-w-xs truncate px-2 py-1">
                    {String(track.comment ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
