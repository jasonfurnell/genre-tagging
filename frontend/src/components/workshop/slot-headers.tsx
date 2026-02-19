import { memo, useMemo } from 'react'
import type { SetSlot } from '@/schemas'
import { WS, buildSourceGroups } from '@/stores/workshop'

interface SlotHeadersProps {
  slots: SetSlot[]
  onSourceClick: (slotId: string) => void
  onAddClick: (slotId: string) => void
  onGroupDragStart: (e: React.DragEvent, slotIds: string[]) => void
  onGroupDragOver: (e: React.DragEvent) => void
  onGroupDrop: (e: React.DragEvent, targetIdx: number) => void
}

export const SlotHeaders = memo(function SlotHeaders({
  slots,
  onSourceClick,
  onAddClick,
  onGroupDragStart,
  onGroupDragOver,
  onGroupDrop,
}: SlotHeadersProps) {
  const groups = useMemo(() => buildSourceGroups(slots), [slots])

  return (
    <div className="flex items-end" style={{ height: 40 }}>
      <div className="w-[100px] shrink-0 pr-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Source
      </div>
      <div className="flex">
        {groups.map((group) => {
          const width = group.count * (WS.COL_W + WS.GAP) - WS.GAP

          if (!group.source) {
            // Empty slot(s) — show "+" button per slot
            return group.slotIds.map((slotId) => (
              <div
                key={slotId}
                className="flex shrink-0 items-center justify-center"
                style={{ width: WS.COL_W, marginRight: WS.GAP }}
              >
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => onAddClick(slotId)}
                  title="Add source"
                >
                  +
                </button>
              </div>
            ))
          }

          // Source group — single spanning header
          return (
            <div
              key={group.key}
              className="shrink-0 cursor-pointer truncate rounded-t border-b-2 border-primary/30 bg-muted/30 px-2 py-1 text-center text-[11px] font-medium transition-colors hover:bg-muted/50"
              style={{ width, marginRight: WS.GAP }}
              draggable
              onDragStart={(e) => onGroupDragStart(e, group.slotIds)}
              onDragOver={onGroupDragOver}
              onDrop={(e) => onGroupDrop(e, group.startIdx)}
              onClick={() => onSourceClick(group.slotIds[0])}
              title={group.source.name}
            >
              {group.source.name}
            </div>
          )
        })}
      </div>
    </div>
  )
})
