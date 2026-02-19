import { Button } from '@/components/ui/button'
import { PhaseProfileSidebar } from './phase-profile-sidebar'
import { PhaseProfileEditor } from './phase-profile-editor'
import { usePhaseProfiles } from '@/hooks/use-phases'
import { usePhasesStore } from '@/stores/phases'

export function PhasesTab() {
  const { data: profiles, isLoading } = usePhaseProfiles()
  const startNew = usePhasesStore((s) => s.startNew)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">Phase Profiles</h2>
        <Button size="sm" onClick={startNew}>
          New Profile
        </Button>
      </div>

      {/* Main area: sidebar + editor */}
      <div className="flex flex-1 overflow-hidden">
        <PhaseProfileSidebar profiles={profiles} isLoading={isLoading} />
        <PhaseProfileEditor />
      </div>
    </div>
  )
}
