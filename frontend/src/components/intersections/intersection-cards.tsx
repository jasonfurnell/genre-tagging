import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { SuggestionCard } from '@/components/shared'
import { useSmartCreatePlaylist } from '@/hooks/use-playlists'
import { usePlaylistsStore } from '@/stores/playlists'
import { useUiStore } from '@/stores/ui'
import type { Suggestion } from '@/schemas'

interface IntersectionCardsProps {
  suggestions: Suggestion[]
  title1: string
  title2: string
  isLoading: boolean
}

export function IntersectionCards({
  suggestions,
  title1,
  title2,
  isLoading,
}: IntersectionCardsProps) {
  const smartCreate = useSmartCreatePlaylist()
  const setSelectedPlaylistId = usePlaylistsStore((s) => s.setSelectedPlaylistId)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const [creatingIndex, setCreatingIndex] = useState<number | null>(null)

  const handleCreatePlaylist = useCallback(
    (suggestion: Suggestion, index: number) => {
      if (!suggestion.filters) {
        toast.error('No filters available')
        return
      }
      setCreatingIndex(index)
      smartCreate.mutate(
        {
          name: suggestion.name,
          description: suggestion.description,
          filters: suggestion.filters,
          target_count: 25,
        },
        {
          onSuccess: (data) => {
            toast.success(`Created "${data.playlist.name}"`)
            setSelectedPlaylistId(data.playlist.id)
            setActiveTab('playlists')
            setCreatingIndex(null)
          },
          onError: (err) => {
            toast.error(`Create failed: ${err.message}`)
            setCreatingIndex(null)
          },
        },
      )
    },
    [smartCreate, setSelectedPlaylistId, setActiveTab],
  )

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-4">
        <p className="text-muted-foreground text-center text-sm">
          Exploring {title1} + {title2}... (this may take a moment)
        </p>
      </div>
    )
  }

  if (suggestions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        {title1} + {title2} — {suggestions.length} suggestions
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {suggestions.map((s, i) => (
          <SuggestionCard
            key={`${s.name}-${i}`}
            suggestion={s}
            onCreatePlaylist={(sug) => handleCreatePlaylist(sug, i)}
            isCreating={creatingIndex === i}
          />
        ))}
      </div>
    </div>
  )
}
