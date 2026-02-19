import { memo } from 'react'
import type { SetSlot } from '@/schemas'
import type { Phase } from '@/schemas'
import { PhaseRow } from './phase-row'
import { SlotHeaders } from './slot-headers'
import { InsertRow } from './insert-row'
import { BpmGrid } from './bpm-grid'
import { KeyRow } from './key-row'
import { PreviewRow } from './preview-row'
import { TimeRow } from './time-row'

interface WorkshopGridProps {
  slots: SetSlot[]
  phases: Phase[]
  playIndex: number
  loadingSlotIds: Set<string>
  onTrackClick: (slotId: string, trackIndex: number) => void
  onPreview: (slotIndex: number) => void
  onSourceClick: (slotId: string) => void
  onAddClick: (slotId: string) => void
  onDeleteSlot: (index: number) => void
  onInsertSlot: (atIndex: number) => void
  onSlotDragStart: (e: React.DragEvent, slotId: string) => void
  onSlotDragOver: (e: React.DragEvent) => void
  onSlotDrop: (e: React.DragEvent, slotId: string) => void
  onGroupDragStart: (e: React.DragEvent, slotIds: string[]) => void
  onGroupDragOver: (e: React.DragEvent) => void
  onGroupDrop: (e: React.DragEvent, targetIdx: number) => void
}

export const WorkshopGrid = memo(function WorkshopGrid({
  slots,
  phases,
  playIndex,
  loadingSlotIds,
  onTrackClick,
  onPreview,
  onSourceClick,
  onAddClick,
  onDeleteSlot,
  onInsertSlot,
  onSlotDragStart,
  onSlotDragOver,
  onSlotDrop,
  onGroupDragStart,
  onGroupDragOver,
  onGroupDrop,
}: WorkshopGridProps) {
  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden">
      <div className="inline-flex min-w-full flex-col">
        <PhaseRow phases={phases} slotCount={slots.length} />
        <SlotHeaders
          slots={slots}
          onSourceClick={onSourceClick}
          onAddClick={onAddClick}
          onGroupDragStart={onGroupDragStart}
          onGroupDragOver={onGroupDragOver}
          onGroupDrop={onGroupDrop}
        />
        <InsertRow slots={slots} onDeleteSlot={onDeleteSlot} onInsertSlot={onInsertSlot} />
        <BpmGrid
          slots={slots}
          playIndex={playIndex}
          loadingSlotIds={loadingSlotIds}
          onTrackClick={onTrackClick}
          onSlotDragStart={onSlotDragStart}
          onSlotDragOver={onSlotDragOver}
          onSlotDrop={onSlotDrop}
        />
        <KeyRow slots={slots} playIndex={playIndex} />
        <PreviewRow slots={slots} onPreview={onPreview} />
        <TimeRow slotCount={slots.length} />
      </div>
    </div>
  )
})
