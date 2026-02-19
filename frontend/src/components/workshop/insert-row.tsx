import { memo, useMemo } from 'react'
import type { SetSlot } from '@/schemas'
import { WS, buildSourceGroups } from '@/stores/workshop'

interface InsertRowProps {
  slots: SetSlot[]
  onDeleteSlot: (index: number) => void
  onInsertSlot: (atIndex: number) => void
}

export const InsertRow = memo(function InsertRow({
  slots,
  onDeleteSlot,
  onInsertSlot,
}: InsertRowProps) {
  const groups = useMemo(() => buildSourceGroups(slots), [slots])

  return (
    <div className="flex items-center" style={{ height: 24 }}>
      <div className="w-[100px] shrink-0" />
      <div className="flex items-center">
        {groups.map((group, gi) => (
          <div key={group.key + gi} className="flex items-center">
            {/* Delete buttons for each slot in group */}
            <div className="flex">
              {group.slotIds.map((slotId, si) => {
                const globalIdx = group.startIdx + si
                const hasContent = !!slots[globalIdx]?.source
                return (
                  <div
                    key={slotId}
                    className="flex shrink-0 items-center justify-center"
                    style={{ width: WS.COL_W, marginRight: WS.GAP }}
                  >
                    {hasContent && (
                      <button
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-muted-foreground/50 transition-colors hover:bg-destructive/20 hover:text-destructive"
                        onClick={() => onDeleteSlot(globalIdx)}
                        title="Remove slot"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Insert button between groups */}
            {gi < groups.length - 1 && (
              <button
                className="-mx-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onInsertSlot(group.startIdx + group.count)}
                title="Insert slot"
              >
                +
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})
