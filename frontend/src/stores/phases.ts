import { create } from 'zustand'
import type { Phase } from '@/schemas'

const PHASE_PALETTE = [
  '#777777',
  '#999999',
  '#BBBBBB',
  '#CCCCCC',
  '#AAAAAA',
  '#888888',
  '#666666',
  '#DDDDDD',
]

function defaultPhases(): Phase[] {
  return [
    { name: 'Opening', pct: [0, 25], desc: '', color: PHASE_PALETTE[0] },
    { name: 'Build', pct: [25, 50], desc: '', color: PHASE_PALETTE[1] },
    { name: 'Peak', pct: [50, 75], desc: '', color: PHASE_PALETTE[2] },
    { name: 'Resolution', pct: [75, 100], desc: '', color: PHASE_PALETTE[3] },
  ]
}

interface PhasesUiState {
  selectedProfileId: string | null
  setSelectedProfileId: (id: string | null) => void

  // Editing state
  editingName: string
  setEditingName: (name: string) => void
  editingDescription: string
  setEditingDescription: (desc: string) => void
  editingPhases: Phase[]
  setEditingPhases: (phases: Phase[]) => void
  isNewProfile: boolean
  setIsNewProfile: (v: boolean) => void

  // Actions
  startNew: () => void
  loadProfile: (name: string, description: string, phases: Phase[]) => void
  addPhase: () => void
  removePhase: (index: number) => void
  updatePhase: (index: number, field: keyof Phase, value: string | [number, number]) => void
  updatePhaseStart: (index: number, value: number) => void
  updatePhaseEnd: (index: number, value: number) => void
  reset: () => void
}

export { PHASE_PALETTE }

export const usePhasesStore = create<PhasesUiState>((set, get) => ({
  selectedProfileId: null,
  setSelectedProfileId: (id) => set({ selectedProfileId: id }),

  editingName: '',
  setEditingName: (name) => set({ editingName: name }),
  editingDescription: '',
  setEditingDescription: (desc) => set({ editingDescription: desc }),
  editingPhases: [],
  setEditingPhases: (phases) => set({ editingPhases: phases }),
  isNewProfile: false,
  setIsNewProfile: (v) => set({ isNewProfile: v }),

  startNew: () =>
    set({
      selectedProfileId: null,
      editingName: '',
      editingDescription: '',
      editingPhases: defaultPhases(),
      isNewProfile: true,
    }),

  loadProfile: (name, description, phases) =>
    set({
      editingName: name,
      editingDescription: description,
      editingPhases: phases.map((p) => ({ ...p, pct: [p.pct[0], p.pct[1]] as [number, number] })),
      isNewProfile: false,
    }),

  addPhase: () => {
    const phases = [...get().editingPhases]
    if (phases.length === 0) {
      set({
        editingPhases: [{ name: 'New Phase', pct: [0, 100], desc: '', color: PHASE_PALETTE[0] }],
      })
      return
    }
    const last = phases[phases.length - 1]
    const mid = Math.round((last.pct[0] + last.pct[1]) / 2)
    phases[phases.length - 1] = { ...last, pct: [last.pct[0], mid] }
    phases.push({
      name: 'New Phase',
      pct: [mid, last.pct[1]],
      desc: '',
      color: PHASE_PALETTE[phases.length % PHASE_PALETTE.length],
    })
    set({ editingPhases: phases })
  },

  removePhase: (index) => {
    const phases = [...get().editingPhases]
    if (phases.length <= 1) return
    const removed = phases[index]
    phases.splice(index, 1)
    // Redistribute to neighbor
    if (index > 0) {
      phases[index - 1] = { ...phases[index - 1], pct: [phases[index - 1].pct[0], removed.pct[1]] }
    } else if (phases.length > 0) {
      phases[0] = { ...phases[0], pct: [removed.pct[0], phases[0].pct[1]] }
    }
    set({ editingPhases: phases })
  },

  updatePhase: (index, field, value) => {
    const phases = [...get().editingPhases]
    phases[index] = { ...phases[index], [field]: value }
    set({ editingPhases: phases })
  },

  updatePhaseStart: (index, value) => {
    const phases = [...get().editingPhases]
    const clamped = Math.max(0, Math.min(99, value))
    phases[index] = { ...phases[index], pct: [clamped, phases[index].pct[1]] }
    // Sync previous phase's end
    if (index > 0) {
      phases[index - 1] = { ...phases[index - 1], pct: [phases[index - 1].pct[0], clamped] }
    }
    set({ editingPhases: phases })
  },

  updatePhaseEnd: (index, value) => {
    const phases = [...get().editingPhases]
    const clamped = Math.max(1, Math.min(100, value))
    phases[index] = { ...phases[index], pct: [phases[index].pct[0], clamped] }
    // Sync next phase's start
    if (index < phases.length - 1) {
      phases[index + 1] = { ...phases[index + 1], pct: [clamped, phases[index + 1].pct[1]] }
    }
    set({ editingPhases: phases })
  },

  reset: () =>
    set({
      selectedProfileId: null,
      editingName: '',
      editingDescription: '',
      editingPhases: [],
      isNewProfile: false,
    }),
}))
