import { cn } from '@/lib/utils'

export const COLLECTION_PHASES = [
  { key: 'intersection_matrix', label: 'Intersections', icon: '1' },
  { key: 'cluster_naming', label: 'Naming', icon: '2' },
  { key: 'reassignment', label: 'Reassigning', icon: '3' },
  { key: 'quality_scoring', label: 'Quality', icon: '4' },
  { key: 'grouping', label: 'Grouping', icon: '5' },
  { key: 'final_descriptions', label: 'Descriptions', icon: '6' },
  { key: 'enrichment', label: 'Enrichment', icon: '7' },
] as const

interface PhaseTimelineProps {
  currentPhase: string
}

export function PhaseTimeline({ currentPhase }: PhaseTimelineProps) {
  const currentIndex = COLLECTION_PHASES.findIndex((p) => p.key === currentPhase)

  return (
    <div className="flex items-center justify-center gap-1 py-2">
      {COLLECTION_PHASES.map((phase, i) => {
        const isDone = currentIndex > i || currentPhase === 'complete'
        const isActive = currentIndex === i
        return (
          <div key={phase.key} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all',
                isDone && 'bg-primary text-primary-foreground',
                isActive && 'bg-primary/30 text-primary ring-primary/50 animate-pulse ring-2',
                !isDone && !isActive && 'bg-muted text-muted-foreground',
              )}
            >
              {isDone ? '✓' : phase.icon}
            </div>
            <span
              className={cn(
                'text-[0.6rem]',
                isDone && 'text-primary',
                isActive && 'text-primary font-medium',
                !isDone && !isActive && 'text-muted-foreground',
              )}
            >
              {phase.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
