import { memo, useMemo } from 'react'
import type { SetSlot } from '@/schemas'
import { WS, bpmToY } from '@/stores/workshop'
import { TrackColumn } from './track-column'
import { EnergyWave } from './energy-wave'

interface BpmGridProps {
  slots: SetSlot[]
  playIndex: number
  loadingSlotIds: Set<string>
  onTrackClick: (slotId: string, trackIndex: number) => void
  onSlotDragStart: (e: React.DragEvent, slotId: string) => void
  onSlotDragOver: (e: React.DragEvent) => void
  onSlotDrop: (e: React.DragEvent, slotId: string) => void
}

export const BpmGrid = memo(function BpmGrid({
  slots,
  playIndex,
  loadingSlotIds,
  onTrackClick,
  onSlotDragStart,
  onSlotDragOver,
  onSlotDrop,
}: BpmGridProps) {
  const totalWidth = slots.length * (WS.COL_W + WS.GAP)

  // Energy wave points: selected tracks' BPMs
  const wavePoints = useMemo(() => {
    const pts: { x: number; y: number }[] = []
    slots.forEach((slot, i) => {
      const sel = slot.selectedTrackIndex
      const track = sel != null && slot.tracks[sel] ? slot.tracks[sel] : null
      if (track?.bpm) {
        const x = i * (WS.COL_W + WS.GAP) + WS.COL_W / 2
        const y = bpmToY(track.bpm)
        pts.push({ x, y })
      }
    })
    return pts
  }, [slots])

  return (
    <div className="flex" style={{ height: WS.AREA_H }}>
      {/* BPM Axis (sticky left) */}
      <div
        className="relative w-[100px] shrink-0 pr-2"
        style={{ height: WS.GRID_H, marginTop: 30, marginBottom: 30 }}
      >
        {WS.BPM_GRIDLINES.filter((_, i) => i % 2 === 0).map((bpm) => (
          <span
            key={bpm}
            className="absolute right-2 text-[10px] text-muted-foreground"
            style={{ top: bpmToY(bpm) - 6 }}
          >
            {bpm}
          </span>
        ))}
      </div>

      {/* Grid area */}
      <div
        className="relative"
        style={{
          width: totalWidth,
          height: WS.AREA_H,
          paddingTop: 30,
          paddingBottom: 30,
        }}
      >
        {/* Horizontal gridlines */}
        {WS.BPM_GRIDLINES.map((bpm) => (
          <div
            key={bpm}
            className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: 30 + bpmToY(bpm) }}
          />
        ))}

        {/* Energy wave SVG */}
        <EnergyWave points={wavePoints} width={totalWidth} height={WS.GRID_H} offsetY={30} />

        {/* Track columns */}
        <div className="absolute flex" style={{ top: 30, left: 0 }}>
          {slots.map((slot, i) => (
            <TrackColumn
              key={slot.id}
              slot={slot}
              slotIndex={i}
              isPlaying={i === playIndex}
              isLoading={loadingSlotIds.has(slot.id)}
              onTrackClick={onTrackClick}
              onDragStart={onSlotDragStart}
              onDragOver={onSlotDragOver}
              onDrop={onSlotDrop}
            />
          ))}
        </div>
      </div>
    </div>
  )
})
