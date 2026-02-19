import { memo } from 'react'
import type { SetSlot } from '@/schemas'
import { WS } from '@/stores/workshop'

interface PreviewRowProps {
  slots: SetSlot[]
  onPreview: (slotIndex: number) => void
}

export const PreviewRow = memo(function PreviewRow({ slots, onPreview }: PreviewRowProps) {
  return (
    <div className="flex items-center" style={{ height: 28 }}>
      <div className="w-[100px] shrink-0" />
      <div className="flex">
        {slots.map((slot, i) => {
          const sel = slot.selectedTrackIndex
          const track = sel != null && slot.tracks[sel] ? slot.tracks[sel] : null
          return (
            <div
              key={slot.id}
              className="flex shrink-0 items-center justify-center"
              style={{ width: WS.COL_W, marginRight: WS.GAP }}
            >
              {track && (
                <button
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => onPreview(i)}
                  title="Play 30s preview"
                >
                  ▶
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
