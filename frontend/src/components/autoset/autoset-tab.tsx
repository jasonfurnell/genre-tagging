import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAutosetStore } from '@/stores/autoset'
import { useAutosetBuild, useAutosetStop } from '@/hooks/use-autoset'
import { usePlaylists } from '@/hooks/use-playlists'
import { usePhaseProfiles } from '@/hooks/use-phases'
import { useTracks } from '@/hooks/use-tracks'
import { subscribeSSE } from '@/lib/sse'
import { api } from '@/lib/api'
import { AutosetForm } from './autoset-form'
import { AutosetProgress } from './autoset-progress'
import { AutosetResult } from './autoset-result'
import type { AutosetResult as AutosetResultType } from '@/stores/autoset'

const PHASES = [
  { key: 'pool_analysis', label: 'Analysis', num: 1 },
  { key: 'narrative_arc', label: 'Narrative', num: 2 },
  { key: 'track_assignment', label: 'Assignment', num: 3 },
  { key: 'track_ordering', label: 'Ordering', num: 4 },
  { key: 'assembly', label: 'Assembly', num: 5 },
]

export function AutoSetTab() {
  const store = useAutosetStore()
  const buildMutation = useAutosetBuild()
  const stopMutation = useAutosetStop()
  const { data: playlists } = usePlaylists()
  const { data: profiles } = usePhaseProfiles()
  const { data: tracks } = useTracks()
  const queryClient = useQueryClient()
  const unsubRef = useRef<(() => void) | null>(null)

  const handleBuild = useCallback(() => {
    store.resetBuildState()
    store.setIsBuilding(true)
    store.setBuildStartTime(Date.now())

    const body = {
      source_type: store.sourceType,
      source_id: store.sourceId,
      phase_profile_id: store.profileId,
      ...(store.sourceType === 'tree_node' ? { tree_type: store.treeType } : {}),
    }

    buildMutation.mutate(body, {
      onSuccess: () => {
        unsubRef.current = subscribeSSE(
          '/api/autoset/progress',
          (event) => {
            if (event.event === 'progress') {
              store.setBuildPhase(event.phase ?? '')
              store.setBuildDetail(event.detail ?? '')
              store.setBuildPercent(event.percent ?? 0)
              store.addLogEntry(event.detail ?? '')
            }
            if (event.event === 'done') {
              store.setBuildPercent(100)
              store.addLogEntry('Build complete!')
              // Fetch the result
              api.get<AutosetResultType>('/api/autoset/result').then((r) => {
                store.setResult(r)
              })
            }
            if (event.event === 'error') {
              store.setBuildError(event.detail ?? 'Unknown error')
              store.addLogEntry(event.detail ?? 'Error', true)
            }
            if (event.event === 'stopped') {
              store.addLogEntry('Build stopped by user')
            }
          },
          () => {
            store.setIsBuilding(false)
            queryClient.invalidateQueries({ queryKey: ['saved-sets'] })
          },
        )
      },
      onError: (err) => {
        store.setBuildError(err instanceof Error ? err.message : 'Build failed to start')
        store.setIsBuilding(false)
      },
    })
  }, [store, buildMutation, queryClient])

  const handleStop = useCallback(() => {
    stopMutation.mutate()
    unsubRef.current?.()
    unsubRef.current = null
  }, [stopMutation])

  const hasData = tracks != null && tracks.length > 0

  if (!hasData) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">No tracks loaded. Upload a CSV in the Tagger tab.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <AutosetForm
          playlists={playlists ?? []}
          profiles={profiles ?? []}
          isBuilding={store.isBuilding}
          onBuild={handleBuild}
          onStop={handleStop}
        />

        {(store.isBuilding || store.activityLog.length > 0) && <AutosetProgress phases={PHASES} />}

        {store.result && <AutosetResult result={store.result} />}
      </div>
    </div>
  )
}
