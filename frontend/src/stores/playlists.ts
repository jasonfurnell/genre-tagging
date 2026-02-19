import { create } from 'zustand'

export type SuggestionMode = 'explore' | 'vibe' | 'seed'

interface PlaylistsUiState {
  selectedPlaylistId: string | null
  setSelectedPlaylistId: (id: string | null) => void
  suggestionMode: SuggestionMode
  setSuggestionMode: (mode: SuggestionMode) => void
  vibeText: string
  setVibeText: (text: string) => void
}

export const usePlaylistsStore = create<PlaylistsUiState>((set) => ({
  selectedPlaylistId: null,
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
  suggestionMode: 'explore',
  setSuggestionMode: (mode) => set({ suggestionMode: mode }),
  vibeText: '',
  setVibeText: (text) => set({ vibeText: text }),
}))
