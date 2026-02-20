import { create } from 'zustand'

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ToolCall {
  tool: string
  label: string
  status: 'running' | 'done'
  summary?: string
  tracks?: { title: string; artist: string; bpm?: number; key?: string }[]
}

export interface ChatMessage {
  id: string
  role: MessageRole
  text: string
  toolCalls?: ToolCall[]
}

interface ChatUiState {
  messages: ChatMessage[]
  isStreaming: boolean
  showWelcome: boolean

  // Actions
  addUserMessage: (text: string) => void
  startAssistantMessage: () => void
  appendToken: (text: string) => void
  addToolCall: (tool: string, label: string) => void
  completeToolCall: (tool: string, summary: string, tracks?: ToolCall['tracks']) => void
  finishAssistantMessage: () => void
  addSystemMessage: (text: string) => void
  setMessages: (msgs: ChatMessage[]) => void
  clearMessages: () => void
  setIsStreaming: (v: boolean) => void
}

let _nextId = 0
function nextId() {
  return `msg-${++_nextId}`
}

const TOOL_LABELS: Record<string, string> = {
  collection_stats: 'Analyzing collection',
  search_tracks: 'Searching tracks',
  get_track_details: 'Loading track details',
  browse_tree: 'Browsing tree',
  list_playlists: 'Listing playlists',
  get_playlist_tracks: 'Loading playlist',
  list_sets: 'Listing sets',
  create_playlist: 'Creating playlist',
  add_tracks_to_playlist: 'Adding to playlist',
}

export function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}

export const useChatStore = create<ChatUiState>((set) => ({
  messages: [],
  isStreaming: false,
  showWelcome: true,

  addUserMessage: (text) =>
    set((s) => ({
      messages: [...s.messages, { id: nextId(), role: 'user', text }],
      showWelcome: false,
    })),

  startAssistantMessage: () =>
    set((s) => ({
      messages: [...s.messages, { id: nextId(), role: 'assistant', text: '', toolCalls: [] }],
      isStreaming: true,
    })),

  appendToken: (text) =>
    set((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, text: last.text + text }
      }
      return { messages: msgs }
    }),

  addToolCall: (tool, label) =>
    set((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant') {
        const toolCalls = [...(last.toolCalls ?? []), { tool, label, status: 'running' as const }]
        msgs[msgs.length - 1] = { ...last, toolCalls }
      }
      return { messages: msgs }
    }),

  completeToolCall: (tool, summary, tracks) =>
    set((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last?.role === 'assistant' && last.toolCalls) {
        const toolCalls = last.toolCalls.map((tc) =>
          tc.tool === tool && tc.status === 'running'
            ? { ...tc, status: 'done' as const, summary, tracks }
            : tc,
        )
        msgs[msgs.length - 1] = { ...last, toolCalls }
      }
      return { messages: msgs }
    }),

  finishAssistantMessage: () => set({ isStreaming: false }),

  addSystemMessage: (text) =>
    set((s) => ({
      messages: [...s.messages, { id: nextId(), role: 'system', text }],
      isStreaming: false,
    })),

  setMessages: (msgs) =>
    set({
      messages: msgs.map((m) => ({ ...m, id: m.id || nextId() })),
      showWelcome: msgs.length === 0,
    }),

  clearMessages: () => set({ messages: [], showWelcome: true, isStreaming: false }),

  setIsStreaming: (v) => set({ isStreaming: v }),
}))
