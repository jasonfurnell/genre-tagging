import { useCallback, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  useCreateAllTreePlaylists,
  useRefreshExamples,
  treeKeys,
  progressUrl,
} from '@/hooks/use-trees'
import { useTreesStore } from '@/stores/trees'
import { subscribeSSE } from '@/lib/sse'
import type { TreeType, TreeNode } from '@/schemas'

function collectLeafIds(nodes: TreeNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.is_leaf || !node.children?.length) ids.push(node.id)
    else ids.push(...collectLeafIds(node.children))
  }
  return ids
}

interface TreeToolbarProps {
  type: TreeType
  lineages?: TreeNode[]
  onRebuild: () => void
}

export function TreeToolbar({ type, lineages, onRebuild }: TreeToolbarProps) {
  const queryClient = useQueryClient()
  const createAll = useCreateAllTreePlaylists(type)
  const refreshExamples = useRefreshExamples(type)
  const isBuilding = useTreesStore((s) => s.isBuilding)
  const markAllCreated = useTreesStore((s) => s.markAllPlaylistsCreated)
  const setIsBuilding = useTreesStore((s) => s.setIsBuilding)
  const resetBuildState = useTreesStore((s) => s.resetBuildState)
  const setBuildStartTime = useTreesStore((s) => s.setBuildStartTime)
  const setBuildPhase = useTreesStore((s) => s.setBuildPhase)
  const setBuildDetail = useTreesStore((s) => s.setBuildDetail)
  const setBuildPercent = useTreesStore((s) => s.setBuildPercent)
  const setBuildError = useTreesStore((s) => s.setBuildError)
  const unsubRef = useRef<(() => void) | null>(null)
  const isCollection = type === 'collection'

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const handleCreateAll = useCallback(() => {
    createAll.mutate(undefined, {
      onSuccess: (data) => {
        const ids = lineages ? collectLeafIds(lineages) : []
        if (ids.length > 0) markAllCreated(type, ids)
        toast.success(`Created ${data.count} playlists`)
      },
      onError: () => toast.error('Failed to create playlists'),
    })
  }, [createAll, type, lineages, markAllCreated])

  const handleRefreshExamples = useCallback(() => {
    resetBuildState()
    setIsBuilding(true)
    setBuildStartTime(Date.now())

    refreshExamples.mutate(undefined, {
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
            queryClient.invalidateQueries({ queryKey: treeKeys[type] })
            toast.success('Exemplar tracks refreshed')
          },
        )
      },
      onError: (err) => {
        setBuildError(err instanceof Error ? err.message : 'Refresh failed')
        setIsBuilding(false)
      },
    })
  }, [
    type,
    refreshExamples,
    queryClient,
    resetBuildState,
    setIsBuilding,
    setBuildStartTime,
    setBuildPhase,
    setBuildDetail,
    setBuildPercent,
    setBuildError,
  ])

  return (
    <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={handleCreateAll}
        disabled={isBuilding || createAll.isPending}
      >
        {createAll.isPending ? 'Creating...' : 'Create All Playlists'}
      </Button>
      {!isCollection && (
        <Button size="sm" variant="secondary" onClick={handleRefreshExamples} disabled={isBuilding}>
          Refresh Examples
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onRebuild} disabled={isBuilding}>
        Rebuild Tree
      </Button>
    </div>
  )
}
