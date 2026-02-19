import { memo } from 'react'
import type { SetSlot } from '@/schemas'
import { normalizeCamelot, camelotColor } from '@/lib/camelot'
import { WS } from '@/stores/workshop'

interface KeyRowProps {
  slots: SetSlot[]
  playIndex: number
}

export const KeyRow = memo(function KeyRow({ slots, playIndex }: KeyRowProps) {
  return (
    <div className="flex items-center" style={{ height: 32 }}>
      <div className="w-[100px] shrink-0 pr-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Key
      </div>
      <div className="flex">
        {slots.map((slot, i) => {
          const sel = slot.selectedTrackIndex
          const track = sel != null && slot.tracks[sel] ? slot.tracks[sel] : null
          const rawKey = track?.key ?? null
          const norm = normalizeCamelot(rawKey)
          const color = camelotColor(rawKey)
          const isActive = i === playIndex

          return (
            <div
              key={slot.id}
              className={`flex shrink-0 items-center justify-center rounded-sm text-[11px] font-medium ${
                isActive ? 'ring-1 ring-primary' : ''
              }`}
              style={{
                width: WS.COL_W,
                marginRight: WS.GAP,
                backgroundColor: color ? `${color}22` : undefined,
                color: color ?? undefined,
              }}
            >
              {norm ?? ''}
            </div>
          )
        })}
      </div>
    </div>
  )
})
