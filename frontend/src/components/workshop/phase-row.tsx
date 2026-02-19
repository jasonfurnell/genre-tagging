import { memo } from 'react'
import type { Phase } from '@/schemas'
import { WS } from '@/stores/workshop'

interface PhaseRowProps {
  phases: Phase[]
  slotCount: number
}

export const PhaseRow = memo(function PhaseRow({ phases, slotCount }: PhaseRowProps) {
  if (phases.length === 0) return null

  const totalWidth = slotCount * (WS.COL_W + WS.GAP)

  return (
    <div className="flex items-center" style={{ height: 36 }}>
      <div className="w-[100px] shrink-0 pr-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Phase
      </div>
      <div className="flex overflow-hidden rounded" style={{ width: totalWidth, height: 28 }}>
        {phases.map((phase, i) => {
          const width = phase.pct[1] - phase.pct[0]
          return (
            <div
              key={i}
              className="flex items-center justify-center overflow-hidden border-r border-background/30 last:border-r-0"
              style={{
                width: `${width}%`,
                backgroundColor: `${phase.color}33`,
              }}
              title={phase.desc}
            >
              {width > 8 && (
                <span
                  className="truncate px-1 text-[9px] font-medium uppercase tracking-wide"
                  style={{ color: phase.color }}
                >
                  {phase.name}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
