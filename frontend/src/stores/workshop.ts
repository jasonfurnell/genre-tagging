import { create } from 'zustand'
import type { SetSlot, SlotSource, TrackOption } from '@/schemas'
import type { Phase } from '@/schemas'

// ── Layout Constants ────────────────────────────────────────

export const WS = {
  IMG: 48,
  PAD: 4,
  COL_W: 56,
  GAP: 6,
  GRID_H: 576,
  AREA_H: 636,
  BPM_MIN: 50,
  BPM_MAX: 170,
  BPM_LEVELS: [60, 70, 80, 90, 100, 110, 120, 130, 140, 150] as const,
  BPM_GRIDLINES: [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170] as const,
  DEFAULT_SLOTS: 40,
} as const

/** Convert BPM to Y pixel offset (170 at top=0, 50 at bottom=GRID_H). */
export function bpmToY(bpm: number): number {
  return (WS.GRID_H * (WS.BPM_MAX - bpm)) / (WS.BPM_MAX - WS.BPM_MIN)
}

// ── Source Groups ───────────────────────────────────────────

export interface SourceGroup {
  startIdx: number
  count: number
  key: string
  source: SlotSource | null
  slotIds: string[]
}

export function buildSourceGroups(slots: SetSlot[]): SourceGroup[] {
  const groups: SourceGroup[] = []
  let i = 0
  while (i < slots.length) {
    const slot = slots[i]
    const src = slot.source ?? null
    const key = src ? `${src.type}:${src.id}:${src.tree_type ?? ''}` : `empty:${i}`
    const group: SourceGroup = { startIdx: i, count: 1, key, source: src, slotIds: [slot.id] }
    if (src) {
      while (i + group.count < slots.length) {
        const next = slots[i + group.count]
        const nextSrc = next.source
        if (
          nextSrc &&
          nextSrc.type === src.type &&
          nextSrc.id === src.id &&
          (nextSrc.tree_type ?? '') === (src.tree_type ?? '')
        ) {
          group.slotIds.push(next.id)
          group.count++
        } else {
          break
        }
      }
    }
    groups.push(group)
    i += group.count
  }
  return groups
}

// ── Types ───────────────────────────────────────────────────

export type DrawerMode = 'browse' | 'detail' | 'search' | 'now-playing'
export type WorkshopMode = 'workshop' | 'playset'

interface WorkshopState {
  // Slots
  slots: SetSlot[]
  setSlots: (slots: SetSlot[]) => void

  // Loaded set identity
  currentSetId: string | null
  currentSetName: string | null
  isDirty: boolean
  setCurrentSet: (id: string | null, name: string | null) => void
  markDirty: () => void
  markClean: () => void

  // Phase profile
  phaseProfileId: string | null
  phases: Phase[]
  setPhaseProfile: (id: string | null, phases: Phase[]) => void

  // Drawer
  drawerOpen: boolean
  drawerMode: DrawerMode
  drawerTargetSlotId: string | null
  drawerSourceType: string | null
  drawerSourceId: string | null
  drawerTreeType: string | null
  drawerSourceName: string | null
  openDrawer: (mode: DrawerMode, targetSlotId?: string | null) => void
  closeDrawer: () => void
  setDrawerSource: (type: string, id: string, treeType: string | null, name: string) => void

  // Base drawer
  baseDrawerOpen: boolean
  setBaseDrawerOpen: (v: boolean) => void

  // Mode
  mode: WorkshopMode
  setMode: (mode: WorkshopMode) => void

  // Playback
  playIndex: number
  setPlayIndex: (idx: number) => void

  // Slot operations
  selectTrack: (slotId: string, trackIndex: number) => void
  updateSlotTracks: (slotId: string, tracks: (TrackOption | null)[], source?: SlotSource) => void
  removeSlot: (index: number) => void
  insertSlot: (atIndex: number) => void
  reorderSlot: (fromIdx: number, toIdx: number) => void
  moveGroup: (fromSlotIds: string[], toIdx: number) => void

  // Loading shimmer state
  loadingSlotIds: Set<string>
  setSlotLoading: (slotId: string, loading: boolean) => void

  // Init
  loadState: (
    slots: SetSlot[],
    setId: string | null,
    setName: string | null,
    phaseProfileId: string | null,
  ) => void
  startNewSet: () => void
}

function makeEmptySlot(): SetSlot {
  return {
    id: crypto.randomUUID().slice(0, 8),
    source: null,
    tracks: [],
    selectedTrackIndex: null,
  }
}

function initEmptySlots(count: number): SetSlot[] {
  return Array.from({ length: count }, () => makeEmptySlot())
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  // Slots
  slots: initEmptySlots(WS.DEFAULT_SLOTS),
  setSlots: (slots) => set({ slots, isDirty: true }),

  // Loaded set
  currentSetId: null,
  currentSetName: null,
  isDirty: false,
  setCurrentSet: (id, name) => set({ currentSetId: id, currentSetName: name }),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),

  // Phase profile
  phaseProfileId: null,
  phases: [],
  setPhaseProfile: (id, phases) => set({ phaseProfileId: id, phases, isDirty: true }),

  // Drawer
  drawerOpen: false,
  drawerMode: 'browse',
  drawerTargetSlotId: null,
  drawerSourceType: null,
  drawerSourceId: null,
  drawerTreeType: null,
  drawerSourceName: null,
  openDrawer: (mode, targetSlotId = null) =>
    set({ drawerOpen: true, drawerMode: mode, drawerTargetSlotId: targetSlotId }),
  closeDrawer: () => {
    const { mode } = get()
    if (mode === 'playset') {
      const { drawerMode } = get()
      if (drawerMode !== 'now-playing') {
        set({ drawerMode: 'now-playing' })
      } else {
        set({ drawerOpen: false, baseDrawerOpen: true })
      }
    } else {
      set({ drawerOpen: false })
    }
  },
  setDrawerSource: (type, id, treeType, name) =>
    set({
      drawerSourceType: type,
      drawerSourceId: id,
      drawerTreeType: treeType,
      drawerSourceName: name,
      drawerMode: 'detail',
    }),

  // Base drawer
  baseDrawerOpen: false,
  setBaseDrawerOpen: (v) => set({ baseDrawerOpen: v }),

  // Mode
  mode: 'workshop',
  setMode: (mode) => set({ mode }),

  // Playback
  playIndex: -1,
  setPlayIndex: (idx) => set({ playIndex: idx }),

  // Slot operations
  selectTrack: (slotId, trackIndex) => {
    const slots = get().slots.map((s) =>
      s.id === slotId ? { ...s, selectedTrackIndex: trackIndex } : s,
    )
    set({ slots, isDirty: true })
  },

  updateSlotTracks: (slotId, tracks, source) => {
    const slots = get().slots.map((s) =>
      s.id === slotId ? { ...s, tracks, ...(source ? { source } : {}) } : s,
    )
    set({ slots, isDirty: true })
  },

  removeSlot: (index) => {
    const slots = [...get().slots]
    slots.splice(index, 1)
    const { playIndex } = get()
    const newPlayIndex = index < playIndex ? playIndex - 1 : playIndex
    set({ slots, isDirty: true, playIndex: Math.min(newPlayIndex, slots.length - 1) })
  },

  insertSlot: (atIndex) => {
    const slots = [...get().slots]
    slots.splice(atIndex, 0, makeEmptySlot())
    const { playIndex } = get()
    set({ slots, isDirty: true, playIndex: atIndex <= playIndex ? playIndex + 1 : playIndex })
  },

  reorderSlot: (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return
    const slots = [...get().slots]
    const [moved] = slots.splice(fromIdx, 1)
    slots.splice(toIdx, 0, moved)
    set({ slots, isDirty: true })
  },

  moveGroup: (fromSlotIds, toIdx) => {
    const slots = [...get().slots]
    const groupSlots = fromSlotIds.map((id) => slots.find((s) => s.id === id)!).filter(Boolean)
    const remaining = slots.filter((s) => !fromSlotIds.includes(s.id))
    const insertAt = Math.min(toIdx, remaining.length)
    remaining.splice(insertAt, 0, ...groupSlots)
    set({ slots: remaining, isDirty: true })
  },

  // Loading
  loadingSlotIds: new Set(),
  setSlotLoading: (slotId, loading) =>
    set((state) => {
      const updated = new Set(state.loadingSlotIds)
      if (loading) updated.add(slotId)
      else updated.delete(slotId)
      return { loadingSlotIds: updated }
    }),

  // Init
  loadState: (slots, setId, setName, phaseProfileId) =>
    set({
      slots: slots.length > 0 ? slots : initEmptySlots(WS.DEFAULT_SLOTS),
      currentSetId: setId,
      currentSetName: setName,
      phaseProfileId,
      isDirty: false,
    }),

  startNewSet: () =>
    set({
      slots: initEmptySlots(WS.DEFAULT_SLOTS),
      currentSetId: null,
      currentSetName: null,
      isDirty: false,
      phaseProfileId: null,
      phases: [],
    }),
}))
