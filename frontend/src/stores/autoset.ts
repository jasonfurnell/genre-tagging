import { create } from 'zustand'

export interface AutosetLogEntry {
  timestamp: string
  detail: string
  isError: boolean
}

export interface AutosetAct {
  name: string
  pct: [number, number]
  color: string
  target_track_count?: number
  bpm_range?: [number, number]
  energy_level?: number
  direction?: string
  transition_note?: string
}

export interface AutosetTrack {
  track_id: number
  act_idx: number
  act_name: string
  title: string
  artist: string
  bpm?: number
  key?: string
  mood?: string
  genre1?: string
}

export interface AutosetResult {
  narrative: string
  acts: AutosetAct[]
  ordered_tracks: AutosetTrack[]
  set: { id: string; name: string; slot_count: number }
  pool_profile: { track_count: number; bpm: Record<string, unknown> }
}

interface AutosetUiState {
  // Form
  sourceType: 'playlist' | 'tree_node'
  setSourceType: (t: 'playlist' | 'tree_node') => void
  sourceId: string
  setSourceId: (id: string) => void
  treeType: string
  setTreeType: (t: string) => void
  profileId: string
  setProfileId: (id: string) => void

  // Build state
  isBuilding: boolean
  setIsBuilding: (v: boolean) => void
  buildPhase: string
  setBuildPhase: (phase: string) => void
  buildDetail: string
  setBuildDetail: (detail: string) => void
  buildPercent: number
  setBuildPercent: (pct: number) => void
  buildError: string | null
  setBuildError: (err: string | null) => void
  buildStartTime: number | null
  setBuildStartTime: (t: number | null) => void

  // Activity log
  activityLog: AutosetLogEntry[]
  addLogEntry: (detail: string, isError?: boolean) => void
  clearActivityLog: () => void

  // Result
  result: AutosetResult | null
  setResult: (r: AutosetResult | null) => void

  // Reset
  resetBuildState: () => void
}

export const useAutosetStore = create<AutosetUiState>((set) => ({
  sourceType: 'playlist',
  setSourceType: (t) => set({ sourceType: t }),
  sourceId: '',
  setSourceId: (id) => set({ sourceId: id }),
  treeType: 'collection',
  setTreeType: (t) => set({ treeType: t }),
  profileId: 'classic_arc',
  setProfileId: (id) => set({ profileId: id }),

  isBuilding: false,
  setIsBuilding: (v) => set({ isBuilding: v }),
  buildPhase: '',
  setBuildPhase: (phase) => set({ buildPhase: phase }),
  buildDetail: '',
  setBuildDetail: (detail) => set({ buildDetail: detail }),
  buildPercent: 0,
  setBuildPercent: (pct) => set({ buildPercent: pct }),
  buildError: null,
  setBuildError: (err) => set({ buildError: err }),
  buildStartTime: null,
  setBuildStartTime: (t) => set({ buildStartTime: t }),

  activityLog: [],
  addLogEntry: (detail, isError = false) =>
    set((state) => {
      const elapsed = state.buildStartTime
        ? Math.round((Date.now() - state.buildStartTime) / 1000)
        : 0
      const mins = Math.floor(elapsed / 60)
      const secs = elapsed % 60
      const timestamp = `${mins}:${String(secs).padStart(2, '0')}`
      const log = [...state.activityLog, { timestamp, detail, isError }]
      return { activityLog: log.slice(-50) }
    }),
  clearActivityLog: () => set({ activityLog: [] }),

  result: null,
  setResult: (r) => set({ result: r }),

  resetBuildState: () =>
    set({
      isBuilding: false,
      buildPhase: '',
      buildDetail: '',
      buildPercent: 0,
      buildError: null,
      buildStartTime: null,
      activityLog: [],
      result: null,
    }),
}))
