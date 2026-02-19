import { useCallback, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useBuildTree, useStopTreeBuild, progressUrl, treeKeys } from '@/hooks/use-trees'
import { useTreesStore } from '@/stores/trees'
import { subscribeSSE } from '@/lib/sse'
import { BuildProgress } from './build-progress'
import type { TreeType } from '@/schemas'

const TREE_TYPE_INFO: Record<TreeType, { title: string; description: string; buildLabel: string }> =
  {
    genre: {
      title: 'Genre Tree',
      description:
        'Build an interactive map of the musical lineages and evolutionary paths in your collection. Organises by genre family trees — broad traditions that branch into sub-genres and movements.',
      buildLabel: 'Build Genre Tree',
    },
    scene: {
      title: 'Scene Explorer',
      description:
        'Map your collection by musical scenes — cohesive cultural moments anchored to specific places and times. Discover the geographic and temporal movements that shaped the music you love.',
      buildLabel: 'Build Scene Tree',
    },
    collection: {
      title: 'Collection',
      description:
        'A curated map of your collection built by cross-referencing genre lineages with cultural scenes. Reveals the unique intersections and identities in your music. Requires both Genre and Scene trees to be built first.',
      buildLabel: 'Build Collection',
    },
  }

interface BuildSectionProps {
  type: TreeType
  hasCheckpoint?: boolean
  checkpointPhase?: number
}

export function BuildSection({ type, hasCheckpoint, checkpointPhase }: BuildSectionProps) {
  const queryClient = useQueryClient()
  const buildTree = useBuildTree(type)
  const stopBuild = useStopTreeBuild(type)
  const isBuilding = useTreesStore((s) => s.isBuilding)
  const setIsBuilding = useTreesStore((s) => s.setIsBuilding)
  const resetBuildState = useTreesStore((s) => s.resetBuildState)
  const setBuildStartTime = useTreesStore((s) => s.setBuildStartTime)
  const setBuildError = useTreesStore((s) => s.setBuildError)
  const setBuildPhase = useTreesStore((s) => s.setBuildPhase)
  const setBuildDetail = useTreesStore((s) => s.setBuildDetail)
  const setBuildPercent = useTreesStore((s) => s.setBuildPercent)
  const setNarrativePhase = useTreesStore((s) => s.setNarrativePhase)
  const addLogEntry = useTreesStore((s) => s.addLogEntry)

  const unsubRef = useRef<(() => void) | null>(null)
  const info = TREE_TYPE_INFO[type]

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const startBuild = useCallback(
    (testMode = false) => {
      resetBuildState()
      setIsBuilding(true)
      setBuildStartTime(Date.now())

      buildTree.mutate(testMode ? { test: true } : undefined, {
        onSuccess: () => {
          unsubRef.current = subscribeSSE(
            progressUrl(type),
            (event) => {
              if (event.event === 'progress') {
                setBuildPhase(event.phase ?? '')
                setBuildDetail(event.detail ?? '')
                setBuildPercent(event.percent ?? 0)
                if (type === 'collection') {
                  setNarrativePhase(event.phase ?? null)
                  if (event.detail) addLogEntry(event.detail)
                }
              }
              if (event.event === 'error') {
                setBuildError(event.detail ?? 'Unknown error')
                if (type === 'collection') {
                  addLogEntry('ERROR: ' + (event.detail ?? 'Unknown error'), true)
                }
              }
              if (event.event === 'stopped') {
                if (type === 'collection') addLogEntry('Build stopped by user')
              }
            },
            () => {
              setIsBuilding(false)
              queryClient.invalidateQueries({ queryKey: treeKeys[type] })
            },
          )
        },
        onError: (err) => {
          setBuildError(err instanceof Error ? err.message : 'Build failed')
          setIsBuilding(false)
        },
      })
    },
    [
      type,
      buildTree,
      queryClient,
      resetBuildState,
      setIsBuilding,
      setBuildStartTime,
      setBuildPhase,
      setBuildDetail,
      setBuildPercent,
      setBuildError,
      setNarrativePhase,
      addLogEntry,
    ],
  )

  const handleStop = useCallback(() => {
    stopBuild.mutate()
    unsubRef.current?.()
    unsubRef.current = null
    setIsBuilding(false)
  }, [stopBuild, setIsBuilding])

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      {!isBuilding ? (
        <div className="max-w-lg text-center">
          <h2 className="text-primary mb-2 text-2xl font-bold">{info.title}</h2>
          <p className="text-muted-foreground mb-6 text-sm leading-relaxed">{info.description}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => startBuild(false)}>{info.buildLabel}</Button>
            {type === 'collection' && hasCheckpoint && (
              <Button variant="secondary" onClick={() => startBuild(false)}>
                Resume (from Phase {checkpointPhase ?? 0})
              </Button>
            )}
            {type === 'collection' && (
              <Button variant="outline" onClick={() => startBuild(true)}>
                Test Run (20 clusters)
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full max-w-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Building {info.title}...</h3>
            <Button size="sm" variant="destructive" onClick={handleStop}>
              Stop
            </Button>
          </div>
          <BuildProgress type={type} />
        </div>
      )}
    </div>
  )
}
