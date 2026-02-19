import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SuggestionCard } from '@/components/shared'
import { useSuggest } from '@/hooks/use-suggestions'
import { useSmartCreatePlaylist } from '@/hooks/use-playlists'
import { usePlaylistsStore } from '@/stores/playlists'
import type { Suggestion } from '@/schemas'

const MODES = [
  { id: 'explore' as const, label: 'Explore' },
  { id: 'vibe' as const, label: 'Vibe' },
  { id: 'seed' as const, label: 'Seed' },
]

export function SuggestionSection() {
  const suggestionMode = usePlaylistsStore((s) => s.suggestionMode)
  const setSuggestionMode = usePlaylistsStore((s) => s.setSuggestionMode)
  const vibeText = usePlaylistsStore((s) => s.vibeText)
  const setVibeText = usePlaylistsStore((s) => s.setVibeText)
  const setSelectedPlaylistId = usePlaylistsStore((s) => s.setSelectedPlaylistId)

  const suggest = useSuggest()
  const smartCreate = useSmartCreatePlaylist()
  const [creatingIndex, setCreatingIndex] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  const handleGenerate = useCallback(() => {
    setExpanded(true)
    suggest.mutate(
      {
        mode: suggestionMode,
        ...(suggestionMode === 'vibe' ? { vibe_text: vibeText } : {}),
      },
      { onError: (err) => toast.error(`Suggestion failed: ${err.message}`) },
    )
  }, [suggest, suggestionMode, vibeText])

  const handleCreatePlaylist = useCallback(
    (suggestion: Suggestion, index: number) => {
      if (!suggestion.filters) {
        toast.error('No filters available for this suggestion')
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
            setCreatingIndex(null)
          },
          onError: (err) => {
            toast.error(`Create failed: ${err.message}`)
            setCreatingIndex(null)
          },
        },
      )
    },
    [smartCreate, setSelectedPlaylistId],
  )

  return (
    <div className="border-t border-border">
      <button
        className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>AI Suggestions</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {/* Mode selector + generate */}
          <div className="flex items-center gap-2">
            {MODES.map((m) => (
              <Button
                key={m.id}
                size="sm"
                variant={suggestionMode === m.id ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setSuggestionMode(m.id)}
              >
                {m.label}
              </Button>
            ))}

            {suggestionMode === 'vibe' && (
              <Input
                placeholder="Describe the vibe..."
                value={vibeText}
                onChange={(e) => setVibeText(e.target.value)}
                className="h-7 max-w-xs text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
            )}

            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleGenerate}
              disabled={suggest.isPending || (suggestionMode === 'vibe' && !vibeText.trim())}
            >
              {suggest.isPending ? 'Generating...' : 'Generate'}
            </Button>
          </div>

          <Separator />

          {/* Results */}
          {suggest.data && suggest.data.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {suggest.data.map((s, i) => (
                <SuggestionCard
                  key={`${s.name}-${i}`}
                  suggestion={s}
                  onCreatePlaylist={(sug) => handleCreatePlaylist(sug, i)}
                  isCreating={creatingIndex === i}
                />
              ))}
            </div>
          )}

          {suggest.isPending && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Generating suggestions...
            </p>
          )}

          {suggest.data && suggest.data.length === 0 && (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No suggestions generated. Try a different mode or parameters.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
