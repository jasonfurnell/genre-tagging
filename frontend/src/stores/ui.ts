import { create } from 'zustand'

export type TabId =
  | 'set-workshop'
  | 'sets'
  | 'tagger'
  | 'intersections'
  | 'playlists'
  | 'tracks'
  | 'trees'
  | 'phases'
  | 'auto-set'
  | 'chat'

interface UiState {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  isUploading: boolean
  setIsUploading: (v: boolean) => void
  hasData: boolean
  setHasData: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'set-workshop',
  setActiveTab: (tab) => set({ activeTab: tab }),
  isUploading: false,
  setIsUploading: (v) => set({ isUploading: v }),
  hasData: false,
  setHasData: (v) => set({ hasData: v }),
}))
