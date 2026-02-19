import { memo, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useTreesStore } from '@/stores/trees'
import { ExemplarTracks } from './exemplar-tracks'
import { NodeActions } from './node-actions'
import type { TreeNode as TreeNodeType, TreeType } from '@/schemas'

interface TreeNodeProps {
  node: TreeNodeType
  type: TreeType
  depth: number
}

export const TreeNodeItem = memo(function TreeNodeItem({ node, type, depth }: TreeNodeProps) {
  const expanded = useTreesStore((s) => s.expandedNodes[type].has(node.id))
  const toggle = useTreesStore((s) => s.toggleNode)

  const handleToggle = useCallback(() => {
    toggle(type, node.id)
  }, [toggle, type, node.id])

  const isLeaf = node.is_leaf || !node.children?.length
  const hasChildren = !isLeaf && node.children && node.children.length > 0

  return (
    <div className="mb-1" style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      {/* Node button */}
      <button
        onClick={handleToggle}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-all',
          'border-border/50 hover:border-primary/30 hover:bg-primary/5',
          expanded && 'border-primary/30 bg-primary/10',
          isLeaf && 'border-l-[3px] border-l-primary/40',
        )}
      >
        {/* Expand icon */}
        <span
          className={cn(
            'inline-block min-w-4 text-xs transition-transform',
            expanded && 'rotate-90',
            isLeaf && 'opacity-0',
          )}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{node.title}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{node.track_count} tracks</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="animate-in slide-in-from-top-1 ml-6 mt-1 duration-200">
          <div className="border-primary/30 rounded-lg border-l-[3px] bg-black/20 p-3">
            {/* Description */}
            {node.description && (
              <p className="text-muted-foreground mb-2 text-xs leading-relaxed">
                {node.description}
              </p>
            )}

            {/* Exemplar tracks */}
            <ExemplarTracks examples={node.examples ?? []} />

            {/* Actions */}
            <NodeActions
              nodeId={node.id}
              type={type}
              nodeTitle={node.title}
              trackCount={node.track_count}
            />
          </div>

          {/* Recursive children */}
          {hasChildren &&
            node.children!.map((child) => (
              <TreeNodeItem key={child.id} node={child} type={type} depth={depth + 1} />
            ))}
        </div>
      )}
    </div>
  )
})
