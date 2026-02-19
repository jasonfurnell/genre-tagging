import { memo, useCallback } from 'react'
import type { SetSlot } from '@/schemas'
import { WS, bpmToY } from '@/stores/workshop'
import { TrackSlot } from './track-slot'

interface TrackColumnProps {
  slot: SetSlot
  slotIndex: number
  isPlaying: boolean
  isLoading: boolean
  onTrackClick: (slotId: string, trackIndex: number) => void
  onDragStart: (e: React.DragEvent, slotId: string) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, slotId: string) => void
}

export const TrackColumn = memo(function TrackColumn({
  slot,
  slotIndex,
  isPlaying,
  isLoading,
  onTrackClick,
  onDragStart,
  onDragOver,
  onDrop,
}: TrackColumnProps) {
  void slotIndex // used by parent for positioning

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      onDragStart(e, slot.id)
    },
    [onDragStart, slot.id],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      onDrop(e, slot.id)
    },
    [onDrop, slot.id],
  )

  const isEmpty = !slot.source && slot.tracks.length === 0

  return (
    <div
      className={`relative shrink-0 rounded-sm transition-colors ${
        isPlaying ? 'bg-primary/10' : ''
      }`}
      style={{
        width: WS.COL_W,
        height: WS.GRID_H,
        marginRight: WS.GAP,
      }}
      draggable={!isEmpty}
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDrop={handleDrop}
    >
      {isEmpty ? (
        <div className="flex h-full items-center justify-center">
          <span className="text-[10px] text-muted-foreground/50">+</span>
        </div>
      ) : (
        slot.tracks.map((track, ti) => {
          if (!track) return null
          const bpm = track.bpm ?? WS.BPM_LEVELS[ti] ?? 100
          const y = bpmToY(bpm)
          return (
            <TrackSlot
              key={track.id}
              track={track}
              isSelected={slot.selectedTrackIndex === ti}
              bpmOffset={y}
              onClick={() => onTrackClick(slot.id, ti)}
              isLoading={isLoading}
            />
          )
        })
      )}
    </div>
  )
})
