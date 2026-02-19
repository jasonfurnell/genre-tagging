import { CollectionCard } from './collection-card'
import type { CollectionCategory as CollectionCategoryType, TreeType } from '@/schemas'

interface CollectionCategoryProps {
  category: CollectionCategoryType
  type: TreeType
}

export function CollectionCategory({ category, type }: CollectionCategoryProps) {
  return (
    <div className="mb-6">
      {/* Category header */}
      <div className="mb-3">
        <h2 className="text-primary text-base font-semibold">{category.title}</h2>
        {category.description && (
          <p className="text-muted-foreground mt-0.5 text-xs">{category.description}</p>
        )}
        <span className="text-muted-foreground text-[0.65rem]">
          {category.track_count} tracks &middot; {category.leaves?.length ?? 0} collections
        </span>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3">
        {category.leaves?.map((leaf) => (
          <CollectionCard key={leaf.id} leaf={leaf} type={type} />
        ))}
      </div>
    </div>
  )
}
