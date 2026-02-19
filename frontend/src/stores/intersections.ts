import { create } from 'zustand'

interface IntersectionsUiState {
  treeType: 'genre' | 'scene'
  setTreeType: (type: 'genre' | 'scene') => void
  threshold: number
  setThreshold: (val: number) => void
  maxLineages: number
  setMaxLineages: (val: number) => void
}

export const useIntersectionsStore = create<IntersectionsUiState>((set) => ({
  treeType: 'genre',
  setTreeType: (type) => set({ treeType: type }),
  threshold: 0.08,
  setThreshold: (val) => set({ threshold: val }),
  maxLineages: 12,
  setMaxLineages: (val) => set({ maxLineages: val }),
}))
