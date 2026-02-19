import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { DrawerBrowse } from './drawer-browse'
import { DrawerDetail } from './drawer-detail'
import { DrawerSearch } from './drawer-search'
import { DrawerNowPlaying } from './drawer-now-playing'
import { useWorkshopStore, type DrawerMode } from '@/stores/workshop'
import type { TrackOption } from '@/schemas'

interface SourceDrawerProps {
  // Audio state for now-playing
  nowPlayingTrack: TrackOption | null
  isPlaying: boolean
  currentTime: number
  duration: number
  onTogglePause: () => void
  onPrev: () => void
  onNext: () => void
  onSeek: (time: number) => void
  // Track drag
  onTrackDragStart: (
    e: React.DragEvent,
    trackId: number,
    sourceType: string,
    sourceId: string,
    treeType: string | null,
    name: string,
  ) => void
  // Source assignment
  onAssignSource: (type: string, id: string, treeType: string | null, name: string) => void
}

const MODE_TITLES: Record<DrawerMode, string> = {
  browse: 'Source Browser',
  detail: 'Source Detail',
  search: 'Track Search',
  'now-playing': 'Now Playing',
}

export function SourceDrawer({
  nowPlayingTrack,
  isPlaying,
  currentTime,
  duration,
  onTogglePause,
  onPrev,
  onNext,
  onSeek,
  onTrackDragStart,
  onAssignSource,
}: SourceDrawerProps) {
  const drawerOpen = useWorkshopStore((s) => s.drawerOpen)
  const drawerMode = useWorkshopStore((s) => s.drawerMode)
  const closeDrawer = useWorkshopStore((s) => s.closeDrawer)
  const openDrawer = useWorkshopStore((s) => s.openDrawer)
  const drawerSourceType = useWorkshopStore((s) => s.drawerSourceType)
  const drawerSourceId = useWorkshopStore((s) => s.drawerSourceId)
  const drawerTreeType = useWorkshopStore((s) => s.drawerTreeType)
  const drawerSourceName = useWorkshopStore((s) => s.drawerSourceName)
  const setDrawerSource = useWorkshopStore((s) => s.setDrawerSource)

  const handleSelectSource = useCallback(
    (type: string, id: string, treeType: string | null, name: string) => {
      setDrawerSource(type, id, treeType, name)
      onAssignSource(type, id, treeType, name)
    },
    [setDrawerSource, onAssignSource],
  )

  const handleBack = useCallback(() => {
    openDrawer('browse')
  }, [openDrawer])

  if (!drawerOpen) return null

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{MODE_TITLES[drawerMode]}</h3>
          {drawerMode !== 'browse' && drawerMode !== 'now-playing' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => openDrawer('search')}
            >
              Search
            </Button>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={closeDrawer}>
          Close
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden p-2">
        {drawerMode === 'browse' && <DrawerBrowse onSelectSource={handleSelectSource} />}
        {drawerMode === 'detail' && (
          <DrawerDetail
            sourceType={drawerSourceType}
            sourceId={drawerSourceId}
            treeType={drawerTreeType}
            sourceName={drawerSourceName}
            onBack={handleBack}
            onTrackDragStart={onTrackDragStart}
          />
        )}
        {drawerMode === 'search' && <DrawerSearch onTrackDragStart={onTrackDragStart} />}
        {drawerMode === 'now-playing' && (
          <DrawerNowPlaying
            track={nowPlayingTrack}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            onTogglePause={onTogglePause}
            onPrev={onPrev}
            onNext={onNext}
            onSeek={onSeek}
          />
        )}
      </div>
    </div>
  )
}
