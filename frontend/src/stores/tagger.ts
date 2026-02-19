import { create } from 'zustand'

interface GenreCounts {
  [genre: string]: number
}

interface TaggerState {
  isTagging: boolean
  setIsTagging: (v: boolean) => void
  progressText: string
  setProgressText: (v: string) => void
  progressPercent: number
  setProgressPercent: (v: number) => void
  genreCounts: GenreCounts
  addGenreFromComment: (comment: string) => void
  resetGenreCounts: () => void
}

export const useTaggerStore = create<TaggerState>((set) => ({
  isTagging: false,
  setIsTagging: (v) => set({ isTagging: v }),
  progressText: '',
  setProgressText: (v) => set({ progressText: v }),
  progressPercent: 0,
  setProgressPercent: (v) => set({ progressPercent: v }),
  genreCounts: {},
  addGenreFromComment: (comment) =>
    set((state) => {
      if (!comment) return state
      const parts = comment.split(';').map((s) => s.trim())
      const counts = { ...state.genreCounts }
      for (const part of parts.slice(0, 2)) {
        if (part) counts[part] = (counts[part] || 0) + 1
      }
      return { genreCounts: counts }
    }),
  resetGenreCounts: () => set({ genreCounts: {} }),
}))
