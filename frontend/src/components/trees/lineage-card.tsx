import { ExemplarTracks } from './exemplar-tracks'
import { NodeActions } from './node-actions'
import { TreeNodeItem } from './tree-node'
import type { TreeNode, TreeType } from '@/schemas'

interface LineageCardProps {
  node: TreeNode
  type: TreeType
}

export function LineageCard({ node, type }: LineageCardProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-5">
      {/* Header */}
      <div className="mb-3 border-b border-primary/25 pb-3">
        <h3 className="text-primary text-lg font-semibold">{node.title}</h3>
        {node.description && (
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{node.description}</p>
        )}
      </div>

      {/* Exemplar tracks */}
      <ExemplarTracks examples={node.examples ?? []} />

      {/* Actions */}
      <NodeActions
        nodeId={node.id}
        type={type}
        nodeTitle={node.title}
        trackCount={node.track_count}
      />

      {/* Children */}
      {node.children && node.children.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {node.children.map((child) => (
            <TreeNodeItem key={child.id} node={child} type={type} depth={0} />
          ))}
        </div>
      )}
    </div>
  )
}
