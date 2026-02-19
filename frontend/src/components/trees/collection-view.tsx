import { CollectionCategory } from './collection-category'
import type { CollectionTree, TreeType } from '@/schemas'

interface CollectionViewProps {
  tree: CollectionTree
  type: TreeType
}

export function CollectionView({ tree, type }: CollectionViewProps) {
  return (
    <div>
      {tree.categories.map((category) => (
        <CollectionCategory key={category.id} category={category} type={type} />
      ))}
    </div>
  )
}
