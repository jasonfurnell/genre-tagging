import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { usePhasesStore } from '@/stores/phases'

interface PhaseTableProps {
  readOnly: boolean
}

export function PhaseTable({ readOnly }: PhaseTableProps) {
  const phases = usePhasesStore((s) => s.editingPhases)
  const updatePhase = usePhasesStore((s) => s.updatePhase)
  const updatePhaseStart = usePhasesStore((s) => s.updatePhaseStart)
  const updatePhaseEnd = usePhasesStore((s) => s.updatePhaseEnd)
  const removePhase = usePhasesStore((s) => s.removePhase)

  if (phases.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="grid grid-cols-[1fr_60px_60px_36px_2fr_32px] items-center gap-2 px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Name</span>
        <span>Start</span>
        <span>End</span>
        <span>Color</span>
        <span>Description</span>
        <span />
      </div>

      {/* Rows */}
      {phases.map((phase, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_60px_60px_36px_2fr_32px] items-center gap-2 rounded px-1 py-0.5"
        >
          <Input
            value={phase.name}
            onChange={(e) => updatePhase(i, 'name', e.target.value)}
            disabled={readOnly}
            className="h-7 text-xs"
            placeholder="Phase name"
          />
          <Input
            type="number"
            value={phase.pct[0]}
            onChange={(e) => updatePhaseStart(i, parseInt(e.target.value) || 0)}
            disabled={readOnly || i === 0}
            min={0}
            max={99}
            className="h-7 text-center text-xs"
          />
          <Input
            type="number"
            value={phase.pct[1]}
            onChange={(e) => updatePhaseEnd(i, parseInt(e.target.value) || 0)}
            disabled={readOnly || i === phases.length - 1}
            min={1}
            max={100}
            className="h-7 text-center text-xs"
          />
          <input
            type="color"
            value={phase.color}
            onChange={(e) => updatePhase(i, 'color', e.target.value)}
            disabled={readOnly}
            className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <Input
            value={phase.desc}
            onChange={(e) => updatePhase(i, 'desc', e.target.value)}
            disabled={readOnly}
            className="h-7 text-xs"
            placeholder="Guidance for this phase"
          />
          {!readOnly && phases.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => removePhase(i)}
            >
              &times;
            </Button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  )
}
