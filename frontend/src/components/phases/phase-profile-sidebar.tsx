import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { PhaseProfileCard } from './phase-profile-card'
import { usePhasesStore } from '@/stores/phases'
import type { PhaseProfile } from '@/schemas'

interface PhaseProfileSidebarProps {
  profiles: PhaseProfile[] | undefined
  isLoading: boolean
}

export function PhaseProfileSidebar({ profiles, isLoading }: PhaseProfileSidebarProps) {
  const selectedId = usePhasesStore((s) => s.selectedProfileId)
  const setSelectedProfileId = usePhasesStore((s) => s.setSelectedProfileId)

  const handleSelect = (id: string) => {
    setSelectedProfileId(id)
  }

  if (isLoading) {
    return (
      <div className="flex w-[280px] shrink-0 flex-col gap-2 border-r border-border p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded" />
        ))}
      </div>
    )
  }

  if (!profiles || profiles.length === 0) {
    return (
      <div className="flex w-[280px] shrink-0 items-center justify-center border-r border-border p-3">
        <p className="text-muted-foreground text-sm">No profiles yet</p>
      </div>
    )
  }

  return (
    <ScrollArea className="w-[280px] shrink-0 border-r border-border">
      <div className="flex flex-col gap-1 p-2">
        {profiles.map((p) => (
          <PhaseProfileCard
            key={p.id}
            profile={p}
            isSelected={selectedId === p.id}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
