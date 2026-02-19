import { Badge } from '@/components/ui/badge'
import { MiniPreviewBar } from './phase-preview-bar'
import type { PhaseProfile } from '@/schemas'

interface PhaseProfileCardProps {
  profile: PhaseProfile
  isSelected: boolean
  onSelect: (id: string) => void
}

export function PhaseProfileCard({ profile, isSelected, onSelect }: PhaseProfileCardProps) {
  return (
    <button
      onClick={() => onSelect(profile.id)}
      className={`flex flex-col gap-1.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent ${
        isSelected ? 'bg-accent ring-1 ring-primary/50' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{profile.name}</span>
        {profile.is_default && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            Default
          </Badge>
        )}
      </div>
      <MiniPreviewBar phases={profile.phases} />
      <span className="text-muted-foreground text-xs">
        {profile.phases.length} phase{profile.phases.length !== 1 ? 's' : ''}
      </span>
    </button>
  )
}
