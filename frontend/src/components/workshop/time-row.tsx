import { memo } from 'react'
import { WS } from '@/stores/workshop'

interface TimeRowProps {
  slotCount: number
}

function formatTime(slot: number): string {
  const totalMinutes = slot * 3
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}:00`
}

export const TimeRow = memo(function TimeRow({ slotCount }: TimeRowProps) {
  return (
    <div className="flex items-center" style={{ height: 28 }}>
      <div className="w-[100px] shrink-0 pr-2 text-right text-[10px] text-muted-foreground" />
      <div className="flex">
        {Array.from({ length: slotCount }, (_, i) => (
          <div
            key={i}
            className="shrink-0 text-center text-[10px] text-muted-foreground"
            style={{ width: WS.COL_W, marginRight: WS.GAP }}
          >
            {formatTime(i)}
          </div>
        ))}
      </div>
    </div>
  )
})
