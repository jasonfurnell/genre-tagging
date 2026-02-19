import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useGenreTree, useSceneTree, useCollectionTree, useDeleteTree } from '@/hooks/use-trees'
import { useTreesStore } from '@/stores/trees'
import { TreeTypeSelector } from './tree-type-selector'
import { BuildSection } from './build-section'
import { TreeStats } from './tree-stats'
import { TreeToolbar } from './tree-toolbar'
import { LineageCard } from './lineage-card'
import { UngroupedSection } from './ungrouped-section'
import { CollectionView } from './collection-view'
import { BuildProgress } from './build-progress'
import { DeleteTreeDialog } from './delete-tree-dialog'
import type { TreeType } from '@/schemas'

const TYPE_NAMES: Record<TreeType, string> = {
  genre: 'Genre Tree',
  scene: 'Scene Tree',
  collection: 'Collection',
}

export function TreesTab() {
  const activeType = useTreesStore((s) => s.activeType)
  const setActiveType = useTreesStore((s) => s.setActiveType)
  const isBuilding = useTreesStore((s) => s.isBuilding)

  const { data: genreData, isLoading: genreLoading } = useGenreTree()
  const { data: sceneData, isLoading: sceneLoading } = useSceneTree()
  const { data: collectionData, isLoading: collectionLoading } = useCollectionTree()

  const deleteGenre = useDeleteTree('genre')
  const deleteScene = useDeleteTree('scene')
  const deleteCollection = useDeleteTree('collection')

  const [rebuildDialogOpen, setRebuildDialogOpen] = useState(false)

  // Current tree data based on active type
  const currentData =
    activeType === 'genre' ? genreData : activeType === 'scene' ? sceneData : collectionData
  const currentLoading =
    activeType === 'genre'
      ? genreLoading
      : activeType === 'scene'
        ? sceneLoading
        : collectionLoading

  // Does the current type have a tree?
  const hasTree = currentData?.tree != null

  // Collection checkpoint info
  const hasCheckpoint =
    activeType === 'collection' && collectionData && 'has_checkpoint' in collectionData
      ? collectionData.has_checkpoint
      : false
  const checkpointPhase =
    activeType === 'collection' && collectionData && 'checkpoint_phase' in collectionData
      ? collectionData.checkpoint_phase
      : 0

  const handleRebuild = useCallback(() => {
    setRebuildDialogOpen(true)
  }, [])

  const confirmRebuild = useCallback(() => {
    const deleteMutation =
      activeType === 'genre' ? deleteGenre : activeType === 'scene' ? deleteScene : deleteCollection

    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(`${TYPE_NAMES[activeType]} deleted`)
        setRebuildDialogOpen(false)
      },
      onError: () => toast.error('Delete failed'),
    })
  }, [activeType, deleteGenre, deleteScene, deleteCollection])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Type selector */}
      <TreeTypeSelector activeType={activeType} onTypeChange={setActiveType} />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {currentLoading ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : !hasTree ? (
          /* Build section */
          <BuildSection
            type={activeType}
            hasCheckpoint={hasCheckpoint}
            checkpointPhase={checkpointPhase}
          />
        ) : isBuilding ? (
          /* Building in progress (e.g. refresh examples) */
          <div className="p-4">
            <BuildProgress type={activeType} />
          </div>
        ) : (
          /* Tree view */
          <div className="p-4">
            {/* Stats */}
            <TreeStats tree={currentData.tree!} type={activeType} />

            {/* Toolbar */}
            <TreeToolbar
              type={activeType}
              lineages={
                activeType !== 'collection' && 'lineages' in currentData.tree!
                  ? currentData.tree!.lineages
                  : undefined
              }
              onRebuild={handleRebuild}
            />

            {/* Genre/Scene: lineage cards */}
            {activeType !== 'collection' && 'lineages' in currentData.tree! && (
              <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(480px,1fr))] gap-4">
                  {currentData.tree!.lineages.map((lineage) => (
                    <LineageCard key={lineage.id} node={lineage} type={activeType} />
                  ))}
                </div>
                <UngroupedSection
                  type={activeType}
                  ungroupedCount={currentData.tree!.ungrouped_track_ids?.length ?? 0}
                />
              </>
            )}

            {/* Collection: category cards */}
            {activeType === 'collection' && 'categories' in currentData.tree! && (
              <CollectionView tree={currentData.tree!} type={activeType} />
            )}
          </div>
        )}
      </div>

      {/* Rebuild confirmation dialog */}
      <DeleteTreeDialog
        open={rebuildDialogOpen}
        onOpenChange={setRebuildDialogOpen}
        typeName={TYPE_NAMES[activeType]}
        onConfirm={confirmRebuild}
      />
    </div>
  )
}
