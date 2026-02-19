import type { HierarchicalTree, CollectionTree, TreeType } from '@/schemas'

function countLeaves(nodes: Array<{ children?: Array<unknown>; is_leaf?: boolean }>): number {
  let count = 0
  for (const node of nodes) {
    const n = node as { children?: Array<unknown>; is_leaf?: boolean }
    if (n.is_leaf || !n.children?.length) count++
    else count += countLeaves(n.children as typeof nodes)
  }
  return count
}

interface TreeStatsProps {
  tree: HierarchicalTree | CollectionTree
  type: TreeType
}

export function TreeStats({ tree, type }: TreeStatsProps) {
  const isCollection = type === 'collection'

  let topCount: number
  let leafCount: number
  let topLabel: string
  let leafLabel: string

  if (isCollection && 'categories' in tree) {
    topCount = tree.categories.length
    leafCount = tree.categories.reduce((sum, c) => sum + (c.leaves?.length ?? 0), 0)
    topLabel = 'Categories'
    leafLabel = 'Collections'
  } else if ('lineages' in tree) {
    topCount = tree.lineages.length
    leafCount = countLeaves(tree.lineages)
    topLabel = 'Lineages'
    leafLabel = 'Leaves'
  } else {
    return null
  }

  const ungrouped = 'ungrouped_track_ids' in tree ? (tree.ungrouped_track_ids?.length ?? 0) : 0

  const stats = [
    { value: tree.total_tracks, label: 'Total Tracks' },
    { value: topCount, label: topLabel },
    { value: leafCount, label: leafLabel },
    { value: tree.assigned_tracks, label: 'Assigned' },
    ...(ungrouped > 0 ? [{ value: ungrouped, label: 'Ungrouped' }] : []),
  ]

  return (
    <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="bg-card rounded-lg border border-border/50 px-4 py-2 text-center"
        >
          <div className="text-primary text-lg font-bold">{s.value.toLocaleString()}</div>
          <div className="text-muted-foreground text-[0.7rem]">{s.label}</div>
        </div>
      ))}
    </div>
  )
}
