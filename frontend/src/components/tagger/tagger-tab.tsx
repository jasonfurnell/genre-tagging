import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { UploadArea } from './upload-area'
import { TrackGrid } from './track-grid'
import { GenreChart } from './genre-chart'
import { SettingsDialog } from './settings-dialog'
import { useTracks, trackKeys } from '@/hooks/use-tracks'
import { useUploadCsv, useTagAll, useStopTagging, useClearAllTracks } from '@/hooks/use-tagger'
import { useTaggerStore } from '@/stores/tagger'
import { subscribeSSE } from '@/lib/sse'
import type { TrackRow } from '@/schemas'

export function TaggerTab() {
  const queryClient = useQueryClient()
  const { data: tracks } = useTracks()
  const uploadCsv = useUploadCsv()
  const tagAll = useTagAll()
  const stopTagging = useStopTagging()
  const clearAll = useClearAllTracks()

  const isTagging = useTaggerStore((s) => s.isTagging)
  const setIsTagging = useTaggerStore((s) => s.setIsTagging)
  const progressText = useTaggerStore((s) => s.progressText)
  const setProgressText = useTaggerStore((s) => s.setProgressText)
  const progressPercent = useTaggerStore((s) => s.progressPercent)
  const setProgressPercent = useTaggerStore((s) => s.setProgressPercent)
  const addGenreFromComment = useTaggerStore((s) => s.addGenreFromComment)
  const resetGenreCounts = useTaggerStore((s) => s.resetGenreCounts)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [didUpload, setDidUpload] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  // Derive whether we have data — either from upload or from restored tracks
  const hasData = didUpload || (tracks != null && tracks.length > 0)

  const handleUpload = useCallback(
    (file: File) => {
      uploadCsv.mutate(file, {
        onSuccess: () => setDidUpload(true),
      })
    },
    [uploadCsv],
  )

  const handleStartTagging = useCallback(() => {
    resetGenreCounts()
    setProgressPercent(0)
    setProgressText('')

    tagAll.mutate(undefined, {
      onSuccess: () => {
        setIsTagging(true)
        unsubRef.current = subscribeSSE(
          '/api/tag/progress',
          (event) => {
            if (event.event === 'progress') {
              setProgressText(event.progress ?? '')
              if (event.progress) {
                const [done, total] = event.progress.split('/').map(Number)
                if (total > 0) setProgressPercent((done / total) * 100)
              }
              if (event.comment) addGenreFromComment(event.comment)
              if (event.id != null) {
                queryClient.setQueryData<TrackRow[]>(trackKeys.all, (old) =>
                  old?.map((t) =>
                    t.id === event.id
                      ? {
                          ...t,
                          comment: event.comment ?? t.comment,
                          year: event.year ?? t.year,
                          status: 'tagged',
                        }
                      : t,
                  ),
                )
              }
            }
          },
          () => {
            setIsTagging(false)
            queryClient.invalidateQueries({ queryKey: trackKeys.all })
          },
        )
      },
    })
  }, [
    tagAll,
    setIsTagging,
    setProgressText,
    setProgressPercent,
    addGenreFromComment,
    resetGenreCounts,
    queryClient,
  ])

  const handleStopTagging = useCallback(() => {
    stopTagging.mutate()
    unsubRef.current?.()
    unsubRef.current = null
    setIsTagging(false)
  }, [stopTagging, setIsTagging])

  const handleClearAll = useCallback(() => {
    if (confirm('Clear all comments? This cannot be undone.')) {
      clearAll.mutate()
    }
  }, [clearAll])

  const handleExport = useCallback(() => {
    window.open('/api/export', '_blank')
  }, [])

  const taggedCount = tracks?.filter((t) => t.status === 'tagged').length ?? 0
  const untaggedCount = tracks?.filter((t) => t.status === 'untagged').length ?? 0
  const totalCount = tracks?.length ?? 0

  if (!hasData) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <UploadArea onUpload={handleUpload} isUploading={uploadCsv.isPending} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {/* Summary */}
      <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
        <span>{totalCount} tracks</span>
        <span className="opacity-50">&middot;</span>
        <span className="text-green-500">{taggedCount} tagged</span>
        <span className="opacity-50">&middot;</span>
        <span className="text-red-400">{untaggedCount} untagged</span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2">
        {!isTagging ? (
          <Button size="sm" onClick={handleStartTagging} disabled={untaggedCount === 0}>
            Tag All
          </Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={handleStopTagging}>
            Stop
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={handleClearAll} disabled={isTagging}>
          Clear All
        </Button>
        <Button size="sm" variant="secondary" onClick={handleExport}>
          Export CSV
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
          Settings
        </Button>
        <UploadArea onUpload={handleUpload} isUploading={uploadCsv.isPending} />
      </div>

      {/* Progress */}
      {isTagging && (
        <div className="flex flex-col gap-1">
          <Progress value={progressPercent} className="h-1" />
          {progressText && (
            <p className="text-muted-foreground text-center text-xs">{progressText}</p>
          )}
        </div>
      )}

      {/* Genre Chart */}
      {isTagging && <GenreChart />}

      {/* Track Grid */}
      {tracks && <TrackGrid tracks={tracks} />}

      {/* Settings Modal */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
