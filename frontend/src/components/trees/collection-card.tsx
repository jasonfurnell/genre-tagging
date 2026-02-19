import { ExemplarTracks } from './exemplar-tracks'
import { NodeActions } from './node-actions'
import type { CollectionLeaf, TreeType } from '@/schemas'

interface CollectionCardProps {
  leaf: CollectionLeaf
  type: TreeType
}

export function CollectionCard({ leaf, type }: CollectionCardProps) {
  const hasSuggestions = leaf.metadata_suggestions && leaf.metadata_suggestions.length > 0

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-4 transition-colors hover:border-primary/30">
      {/* Header */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{leaf.title}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasSuggestions && (
            <span className="text-[0.65rem] font-semibold text-amber-400">suggestions</span>
          )}
          <span className="text-muted-foreground text-xs">{leaf.track_count}</span>
        </div>
      </div>

      {/* Description */}
      {leaf.description && (
        <p className="text-muted-foreground mb-2 line-clamp-2 text-xs leading-relaxed">
          {leaf.description}
        </p>
      )}

      {/* Context tags */}
      {(leaf.genre_context || leaf.scene_context) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {leaf.genre_context && (
            <span className="rounded border border-sky-400/25 px-1.5 py-0.5 text-[0.6rem] text-sky-300/90">
              {leaf.genre_context}
            </span>
          )}
          {leaf.scene_context && (
            <span className="rounded border border-orange-400/25 px-1.5 py-0.5 text-[0.6rem] text-orange-300/90">
              {leaf.scene_context}
            </span>
          )}
        </div>
      )}

      {/* Exemplar tracks */}
      <ExemplarTracks examples={leaf.examples ?? []} maxVisible={5} />

      {/* Actions */}
      <NodeActions
        nodeId={leaf.id}
        type={type}
        nodeTitle={leaf.title}
        trackCount={leaf.track_count}
      />
    </div>
  )
}
