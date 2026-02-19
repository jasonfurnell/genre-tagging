import type { Phase } from '@/schemas'

interface PhasePreviewBarProps {
  phases: Phase[]
  height?: string
}

export function PhasePreviewBar({ phases, height = 'h-11' }: PhasePreviewBarProps) {
  if (phases.length === 0) return null

  return (
    <div className={`flex w-full overflow-hidden rounded ${height}`}>
      {phases.map((phase, i) => {
        const width = phase.pct[1] - phase.pct[0]
        return (
          <div
            key={i}
            className="flex items-center justify-center overflow-hidden border-r border-background/30 last:border-r-0"
            style={{
              width: `${width}%`,
              backgroundColor: `${phase.color}33`,
              borderLeft: i > 0 ? `1px solid ${phase.color}66` : undefined,
            }}
          >
            {width > 8 && (
              <span
                className="truncate px-1 text-center text-[10px] font-medium uppercase tracking-wide"
                style={{ color: phase.color }}
              >
                {phase.name}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Compact preview bar for sidebar cards */
export function MiniPreviewBar({ phases }: { phases: Phase[] }) {
  if (phases.length === 0) return null

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-sm">
      {phases.map((phase, i) => (
        <div
          key={i}
          className="border-r border-background/30 last:border-r-0"
          style={{
            width: `${phase.pct[1] - phase.pct[0]}%`,
            backgroundColor: phase.color,
          }}
        />
      ))}
    </div>
  )
}
