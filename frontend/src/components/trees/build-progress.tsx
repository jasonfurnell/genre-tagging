import { Progress } from '@/components/ui/progress'
import { useTreesStore } from '@/stores/trees'
import { PhaseTimeline } from './phase-timeline'
import { PhaseNarrative } from './phase-narrative'
import { ActivityLog } from './activity-log'
import type { TreeType } from '@/schemas'

const PHASE_LABELS: Record<string, string> = {
  analyzing: 'Analyzing Collection',
  lineages: 'Identifying Lineages',
  assigning: 'Assigning Tracks',
  primary_branches: 'Building Primary Branches',
  secondary_branches: 'Building Secondary Branches',
  tertiary_branches: 'Building Tertiary Branches',
  finalizing_leaves: 'Finalizing Leaf Nodes',
  lineage_examples: 'Selecting Exemplar Tracks',
  branch_examples: 'Selecting Branch Exemplars',
  refreshing_examples: 'Refreshing Exemplar Tracks',
  intersection_matrix: 'Computing Intersections',
  cluster_naming: 'Naming Clusters',
  reassignment: 'Reassigning Tracks',
  quality_scoring: 'Scoring Cluster Quality',
  grouping: 'Grouping Categories',
  final_descriptions: 'Writing Descriptions',
  enrichment: 'Enriching Metadata',
  complete: 'Complete!',
}

interface BuildProgressProps {
  type: TreeType
}

export function BuildProgress({ type }: BuildProgressProps) {
  const buildPhase = useTreesStore((s) => s.buildPhase)
  const buildDetail = useTreesStore((s) => s.buildDetail)
  const buildPercent = useTreesStore((s) => s.buildPercent)
  const buildError = useTreesStore((s) => s.buildError)
  const narrativePhase = useTreesStore((s) => s.narrativePhase)
  const activityLog = useTreesStore((s) => s.activityLog)

  const isCollection = type === 'collection'
  const phaseLabel = PHASE_LABELS[buildPhase] ?? buildPhase

  return (
    <div className="mx-auto mt-4 max-w-2xl">
      {/* Phase label */}
      <h3 className="mb-2 text-center text-sm font-semibold">{phaseLabel}</h3>

      {/* Progress bar */}
      <Progress value={buildPercent} className="h-1.5" />

      {/* Detail text */}
      {buildDetail && (
        <p className="text-muted-foreground mt-1 text-center text-xs">{buildDetail}</p>
      )}

      {/* Error */}
      {buildError && (
        <div className="bg-destructive/10 text-destructive mt-2 rounded px-3 py-2 text-xs">
          {buildError}
        </div>
      )}

      {/* Collection-specific: phase timeline + narrative + activity log */}
      {isCollection && (
        <>
          <PhaseTimeline currentPhase={buildPhase} />
          <PhaseNarrative phase={narrativePhase} />
          <ActivityLog entries={activityLog} />
        </>
      )}
    </div>
  )
}
