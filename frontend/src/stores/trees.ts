import { create } from 'zustand'
import type { TreeType } from '@/schemas'

export interface LogEntry {
  timestamp: string
  detail: string
  isError: boolean
}

interface TreesUiState {
  // Active tree type
  activeType: TreeType
  setActiveType: (type: TreeType) => void

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

  // Build start time (for log timestamps)
  buildStartTime: number | null
  setBuildStartTime: (t: number | null) => void

  // Activity log (collection build)
  activityLog: LogEntry[]
  addLogEntry: (detail: string, isError?: boolean) => void
  clearActivityLog: () => void

  // Current narrative phase (collection build)
  narrativePhase: string | null
  setNarrativePhase: (phase: string | null) => void

  // Expanded nodes per tree type
  expandedNodes: Record<TreeType, Set<string>>
  toggleNode: (type: TreeType, nodeId: string) => void

  // Created playlist node IDs per tree type
  createdPlaylistNodeIds: Record<TreeType, Set<string>>
  markPlaylistCreated: (type: TreeType, nodeId: string) => void
  markAllPlaylistsCreated: (type: TreeType, nodeIds: string[]) => void

  // Reset build state
  resetBuildState: () => void
}

export const useTreesStore = create<TreesUiState>((set) => ({
  activeType: 'collection',
  setActiveType: (type) => set({ activeType: type }),

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

  narrativePhase: null,
  setNarrativePhase: (phase) => set({ narrativePhase: phase }),

  expandedNodes: { genre: new Set(), scene: new Set(), collection: new Set() },
  toggleNode: (type, nodeId) =>
    set((state) => {
      const updated = new Set(state.expandedNodes[type])
      if (updated.has(nodeId)) updated.delete(nodeId)
      else updated.add(nodeId)
      return { expandedNodes: { ...state.expandedNodes, [type]: updated } }
    }),

  createdPlaylistNodeIds: { genre: new Set(), scene: new Set(), collection: new Set() },
  markPlaylistCreated: (type, nodeId) =>
    set((state) => {
      const updated = new Set(state.createdPlaylistNodeIds[type])
      updated.add(nodeId)
      return { createdPlaylistNodeIds: { ...state.createdPlaylistNodeIds, [type]: updated } }
    }),
  markAllPlaylistsCreated: (type, nodeIds) =>
    set((state) => {
      const updated = new Set(state.createdPlaylistNodeIds[type])
      for (const id of nodeIds) updated.add(id)
      return { createdPlaylistNodeIds: { ...state.createdPlaylistNodeIds, [type]: updated } }
    }),

  resetBuildState: () =>
    set({
      isBuilding: false,
      buildPhase: '',
      buildDetail: '',
      buildPercent: 0,
      buildError: null,
      buildStartTime: null,
      activityLog: [],
      narrativePhase: null,
    }),
}))
