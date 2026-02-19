import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WorkshopToolbar } from './workshop-toolbar'
import { WorkshopGrid } from './workshop-grid'
import { SourceDrawer } from './source-drawer'
import { BaseDrawer } from './base-drawer'
import { useWorkshopStore } from '@/stores/workshop'
import { useWorkshopState, useAssignSource, useDragTrack } from '@/hooks/use-workshop'
import { useAutoSave } from '@/hooks/use-auto-save'
import { useWorkshopAudio } from '@/hooks/use-workshop-audio'
import { usePhaseProfile } from '@/hooks/use-phases'
import type { SetSlot } from '@/schemas'

export function WorkshopTab() {
  const slots = useWorkshopStore((s) => s.slots)
  const phases = useWorkshopStore((s) => s.phases)
  const playIndex = useWorkshopStore((s) => s.playIndex)
  const loadingSlotIds = useWorkshopStore((s) => s.loadingSlotIds)
  const mode = useWorkshopStore((s) => s.mode)
  const baseDrawerOpen = useWorkshopStore((s) => s.baseDrawerOpen)
  const phaseProfileId = useWorkshopStore((s) => s.phaseProfileId)

  const loadState = useWorkshopStore((s) => s.loadState)
  const selectTrack = useWorkshopStore((s) => s.selectTrack)
  const updateSlotTracks = useWorkshopStore((s) => s.updateSlotTracks)
  const removeSlot = useWorkshopStore((s) => s.removeSlot)
  const insertSlot = useWorkshopStore((s) => s.insertSlot)
  const reorderSlot = useWorkshopStore((s) => s.reorderSlot)
  const moveGroup = useWorkshopStore((s) => s.moveGroup)
  const openDrawer = useWorkshopStore((s) => s.openDrawer)
  const setDrawerSource = useWorkshopStore((s) => s.setDrawerSource)
  const setSlotLoading = useWorkshopStore((s) => s.setSlotLoading)
  const setPlayIndex = useWorkshopStore((s) => s.setPlayIndex)
  const setBaseDrawerOpen = useWorkshopStore((s) => s.setBaseDrawerOpen)
  const setPhaseProfile = useWorkshopStore((s) => s.setPhaseProfile)
  const drawerTargetSlotId = useWorkshopStore((s) => s.drawerTargetSlotId)

  // Auto-save
  useAutoSave()

  // Load saved state on mount
  const { data: savedState } = useWorkshopState()
  const loaded = useRef(false)
  useEffect(() => {
    if (savedState && !loaded.current) {
      loaded.current = true
      const rawSlots = (savedState.slots ?? []) as unknown as SetSlot[]
      loadState(
        rawSlots,
        savedState.set_id ?? null,
        savedState.set_name ?? null,
        savedState.phase_profile_id ?? null,
      )
    }
  }, [savedState, loadState])

  // Load phase profile when ID changes
  const { data: phaseProfile } = usePhaseProfile(phaseProfileId)
  useEffect(() => {
    if (phaseProfile) {
      setPhaseProfile(phaseProfile.id, phaseProfile.phases)
    }
  }, [phaseProfile, setPhaseProfile])

  // Audio
  const audio = useWorkshopAudio()

  // Get currently playing track
  const playingSlot = playIndex >= 0 && playIndex < slots.length ? slots[playIndex] : null
  const playingTrack =
    playingSlot?.selectedTrackIndex != null
      ? (playingSlot.tracks[playingSlot.selectedTrackIndex] ?? null)
      : null

  // Assign source mutation
  const assignSource = useAssignSource()
  const dragTrack = useDragTrack()

  // Refill BPM state
  const [isRefilling, setIsRefilling] = useState(false)

  // ── Handlers ──────────────────────────────────────────────

  const handleTrackClick = useCallback(
    (slotId: string, trackIndex: number) => {
      selectTrack(slotId, trackIndex)
      if (mode === 'playset') {
        const idx = slots.findIndex((s) => s.id === slotId)
        if (idx >= 0) {
          const track = slots[idx].tracks[trackIndex]
          if (track) {
            setPlayIndex(idx)
            audio.play(track.id, () => {
              // Auto-advance
              const nextIdx = findNextPlayableSlot(slots, idx + 1)
              if (nextIdx >= 0) {
                setPlayIndex(nextIdx)
                const nextSlot = slots[nextIdx]
                const nextTrack =
                  nextSlot.selectedTrackIndex != null
                    ? nextSlot.tracks[nextSlot.selectedTrackIndex]
                    : null
                if (nextTrack) audio.play(nextTrack.id)
              }
            })
          }
        }
      }
    },
    [selectTrack, mode, slots, setPlayIndex, audio],
  )

  const handlePreview = useCallback(
    (slotIndex: number) => {
      const slot = slots[slotIndex]
      const track = slot?.selectedTrackIndex != null ? slot.tracks[slot.selectedTrackIndex] : null
      if (!track) return
      // Use the preview endpoint (Deezer 30s)
      const previewUrl = `/api/preview?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`
      const a = new Audio(previewUrl)
      a.volume = 0.7
      a.play().catch(() => {})
    },
    [slots],
  )

  const handleSourceClick = useCallback(
    (slotId: string) => {
      const slot = slots.find((s) => s.id === slotId)
      if (slot?.source) {
        setDrawerSource(
          slot.source.type ?? 'playlist',
          slot.source.id,
          slot.source.tree_type ?? null,
          slot.source.name,
        )
        openDrawer('detail', slotId)
      }
    },
    [slots, setDrawerSource, openDrawer],
  )

  const handleAddClick = useCallback(
    (slotId: string) => {
      openDrawer('browse', slotId)
    },
    [openDrawer],
  )

  const handleAssignSource = useCallback(
    (type: string, id: string, treeType: string | null, name: string) => {
      const targetId = drawerTargetSlotId
      if (!targetId) return

      const usedIds = slots
        .flatMap((s) => s.tracks)
        .filter(Boolean)
        .map((t) => t!.id)

      setSlotLoading(targetId, true)
      assignSource.mutate(
        {
          source_type: type,
          source_id: id,
          tree_type: treeType ?? 'genre',
          used_track_ids: usedIds,
        },
        {
          onSuccess: (data) => {
            const source = { ...data.source, type, tree_type: treeType, name }
            updateSlotTracks(targetId, data.tracks, source)
            // Auto-select a track near 100 BPM
            const tracks = data.tracks
            const defaultIdx = tracks.findIndex(
              (t) => t && t.bpm_level != null && t.bpm_level >= 90 && t.bpm_level <= 110,
            )
            if (defaultIdx >= 0) selectTrack(targetId, defaultIdx)
            else {
              const firstIdx = tracks.findIndex((t) => t != null)
              if (firstIdx >= 0) selectTrack(targetId, firstIdx)
            }
            setSlotLoading(targetId, false)
          },
          onError: () => {
            toast.error('Failed to assign source')
            setSlotLoading(targetId, false)
          },
        },
      )
    },
    [drawerTargetSlotId, slots, assignSource, updateSlotTracks, selectTrack, setSlotLoading],
  )

  // Drag & drop handlers
  const dragDataRef = useRef<{
    type: 'slot' | 'group' | 'track'
    slotId?: string
    slotIds?: string[]
    trackId?: number
    sourceType?: string
    sourceId?: string
    treeType?: string | null
    name?: string
  } | null>(null)

  const handleSlotDragStart = useCallback((e: React.DragEvent, slotId: string) => {
    dragDataRef.current = { type: 'slot', slotId }
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleGroupDragStart = useCallback((e: React.DragEvent, slotIds: string[]) => {
    dragDataRef.current = { type: 'group', slotIds }
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleSlotDrop = useCallback(
    (e: React.DragEvent, targetSlotId: string) => {
      e.preventDefault()
      const data = dragDataRef.current
      if (!data) return

      const targetIdx = slots.findIndex((s) => s.id === targetSlotId)
      if (targetIdx < 0) return

      if (data.type === 'slot' && data.slotId) {
        const fromIdx = slots.findIndex((s) => s.id === data.slotId)
        if (fromIdx >= 0 && fromIdx !== targetIdx) {
          reorderSlot(fromIdx, targetIdx)
        }
      } else if (data.type === 'group' && data.slotIds) {
        moveGroup(data.slotIds, targetIdx)
      } else if (data.type === 'track' && data.trackId != null) {
        // Handle track drop from drawer
        const usedIds = slots
          .flatMap((s) => s.tracks)
          .filter(Boolean)
          .map((t) => t!.id)

        setSlotLoading(targetSlotId, true)
        dragTrack.mutate(
          {
            track_id: data.trackId,
            source_type: data.sourceType ?? 'adhoc',
            source_id: data.sourceId ?? `adhoc-${data.trackId}`,
            tree_type: data.treeType ?? 'genre',
            used_track_ids: usedIds,
            track_ids: [data.trackId],
            name: data.name ?? 'Ad-hoc',
          },
          {
            onSuccess: (result) => {
              const source = {
                ...result.source,
                type: data.sourceType ?? 'adhoc',
                tree_type: data.treeType,
              }
              updateSlotTracks(targetSlotId, result.tracks, source)
              // Select the anchor track
              const anchorIdx = result.tracks.findIndex((t) => t && t.id === data.trackId)
              if (anchorIdx >= 0) selectTrack(targetSlotId, anchorIdx)
              else {
                const firstIdx = result.tracks.findIndex((t) => t != null)
                if (firstIdx >= 0) selectTrack(targetSlotId, firstIdx)
              }
              setSlotLoading(targetSlotId, false)
            },
            onError: () => {
              toast.error('Failed to assign track')
              setSlotLoading(targetSlotId, false)
            },
          },
        )
      }
      dragDataRef.current = null
    },
    [slots, reorderSlot, moveGroup, dragTrack, updateSlotTracks, selectTrack, setSlotLoading],
  )

  const handleGroupDrop = useCallback(
    (e: React.DragEvent, targetIdx: number) => {
      e.preventDefault()
      const data = dragDataRef.current
      if (!data) return
      if (data.type === 'group' && data.slotIds) {
        moveGroup(data.slotIds, targetIdx)
      }
      dragDataRef.current = null
    },
    [moveGroup],
  )

  const handleTrackDragStart = useCallback(
    (
      e: React.DragEvent,
      trackId: number,
      sourceType: string,
      sourceId: string,
      treeType: string | null,
      name: string,
    ) => {
      dragDataRef.current = { type: 'track', trackId, sourceType, sourceId, treeType, name }
      e.dataTransfer.effectAllowed = 'copy'
    },
    [],
  )

  // Refill BPM via SSE
  const handleRefillBpm = useCallback(() => {
    const filledSlots = slots
      .map((s, i) => ({ ...s, _index: i }))
      .filter((s) => s.source && s.tracks.length > 0 && s.selectedTrackIndex != null)

    if (filledSlots.length === 0) {
      toast.error('No filled slots to refill')
      return
    }

    setIsRefilling(true)

    const slotsPayload = filledSlots.map((s) => ({
      source: s.source,
      tracks: s.tracks,
      selectedTrackIndex: s.selectedTrackIndex,
    }))

    fetch('/api/set-workshop/refill-bpm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: slotsPayload }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Refill failed')
        const reader = res.body?.getReader()
        if (!reader) throw new Error('No response body')
        const decoder = new TextDecoder()
        let buffer = ''

        function pump(): Promise<void> {
          return reader!.read().then(({ done, value }) => {
            if (done) {
              setIsRefilling(false)
              toast.success('BPM refill complete')
              return
            }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const json = line.slice(6).trim()
              if (!json) continue
              try {
                const event = JSON.parse(json)
                if (event.done) {
                  setIsRefilling(false)
                  toast.success('BPM refill complete')
                  return
                }
                if (event.slot_index != null) {
                  const originalSlot = filledSlots[event.slot_index]
                  if (originalSlot) {
                    updateSlotTracks(slots[originalSlot._index].id, event.tracks, event.source)
                  }
                }
              } catch {
                // skip malformed events
              }
            }
            return pump()
          })
        }

        return pump()
      })
      .catch(() => {
        setIsRefilling(false)
        toast.error('BPM refill failed')
      })
  }, [slots, updateSlotTracks])

  // Audio controls
  const handlePrev = useCallback(() => {
    const idx = findPrevPlayableSlot(slots, playIndex - 1)
    if (idx >= 0) {
      setPlayIndex(idx)
      const slot = slots[idx]
      const track = slot.selectedTrackIndex != null ? slot.tracks[slot.selectedTrackIndex] : null
      if (track) audio.play(track.id)
    }
  }, [slots, playIndex, setPlayIndex, audio])

  const handleNext = useCallback(() => {
    const idx = findNextPlayableSlot(slots, playIndex + 1)
    if (idx >= 0) {
      setPlayIndex(idx)
      const slot = slots[idx]
      const track = slot.selectedTrackIndex != null ? slot.tracks[slot.selectedTrackIndex] : null
      if (track) audio.play(track.id)
    }
  }, [slots, playIndex, setPlayIndex, audio])

  const handleExpand = useCallback(() => {
    setBaseDrawerOpen(false)
    openDrawer('now-playing')
  }, [setBaseDrawerOpen, openDrawer])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkshopToolbar onRefillBpm={handleRefillBpm} isRefilling={isRefilling} />

      <div className="flex flex-1 overflow-hidden">
        <WorkshopGrid
          slots={slots}
          phases={phases}
          playIndex={playIndex}
          loadingSlotIds={loadingSlotIds}
          onTrackClick={handleTrackClick}
          onPreview={handlePreview}
          onSourceClick={handleSourceClick}
          onAddClick={handleAddClick}
          onDeleteSlot={removeSlot}
          onInsertSlot={insertSlot}
          onSlotDragStart={handleSlotDragStart}
          onSlotDragOver={handleDragOver}
          onSlotDrop={handleSlotDrop}
          onGroupDragStart={handleGroupDragStart}
          onGroupDragOver={handleDragOver}
          onGroupDrop={handleGroupDrop}
        />
        <SourceDrawer
          nowPlayingTrack={playingTrack}
          isPlaying={audio.isPlaying}
          currentTime={audio.currentTime}
          duration={audio.duration}
          onTogglePause={audio.togglePause}
          onPrev={handlePrev}
          onNext={handleNext}
          onSeek={audio.seek}
          onTrackDragStart={handleTrackDragStart}
          onAssignSource={handleAssignSource}
        />
      </div>

      <BaseDrawer
        open={baseDrawerOpen && mode === 'playset'}
        track={playingTrack}
        isPlaying={audio.isPlaying}
        currentTime={audio.currentTime}
        duration={audio.duration}
        onTogglePause={audio.togglePause}
        onPrev={handlePrev}
        onNext={handleNext}
        onExpand={handleExpand}
      />
    </div>
  )
}

// Helpers
function findNextPlayableSlot(slots: SetSlot[], fromIdx: number): number {
  for (let i = fromIdx; i < slots.length; i++) {
    const s = slots[i]
    if (s.selectedTrackIndex != null && s.tracks[s.selectedTrackIndex]) return i
  }
  return -1
}

function findPrevPlayableSlot(slots: SetSlot[], fromIdx: number): number {
  for (let i = fromIdx; i >= 0; i--) {
    const s = slots[i]
    if (s.selectedTrackIndex != null && s.tracks[s.selectedTrackIndex]) return i
  }
  return -1
}
