import { useEffect, useRef } from 'react'
import { useAutosetStore } from '@/stores/autoset'
import { cn } from '@/lib/utils'

interface Phase {
  key: string
  label: string
  num: number
}

interface AutosetProgressProps {
  phases: Phase[]
}

export function AutosetProgress({ phases }: AutosetProgressProps) {
  const buildPhase = useAutosetStore((s) => s.buildPhase)
  const buildDetail = useAutosetStore((s) => s.buildDetail)
  const buildPercent = useAutosetStore((s) => s.buildPercent)
  const buildError = useAutosetStore((s) => s.buildError)
  const activityLog = useAutosetStore((s) => s.activityLog)
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [activityLog])

  // Determine phase states
  const phaseIdx = phases.findIndex((p) => p.key === buildPhase)

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      {/* Phase timeline */}
      <div className="flex gap-2">
        {phases.map((phase, i) => {
          const isDone = i < phaseIdx || buildPercent >= 100
          const isActive = i === phaseIdx && buildPercent < 100
          return (
            <div
              key={phase.key}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium border',
                isDone && 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
                isActive && 'border-blue-500/50 bg-blue-500/10 text-blue-400',
                !isDone && !isActive && 'border-border text-muted-foreground',
              )}
            >
              {phase.num}. {phase.label}
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${buildPercent}%` }}
        />
      </div>

      {/* Status */}
      <p className="text-muted-foreground text-xs">
        {buildError ? (
          <span className="text-destructive">{buildError}</span>
        ) : (
          buildDetail || 'Starting...'
        )}
      </p>

      {/* Activity log */}
      {activityLog.length > 0 && (
        <div
          ref={logRef}
          className="max-h-36 overflow-y-auto rounded border border-border bg-background p-2 font-mono text-[0.65rem] leading-relaxed"
        >
          {activityLog.map((entry, i) => (
            <div key={i} className={cn(entry.isError && 'text-destructive')}>
              <span className="text-muted-foreground/60 mr-2">{entry.timestamp}</span>
              {entry.detail}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
