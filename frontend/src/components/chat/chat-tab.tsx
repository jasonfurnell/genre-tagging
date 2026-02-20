import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore, getToolLabel } from '@/stores/chat'
import { useSendMessage, useChatStop, useChatClear, useChatHistory } from '@/hooks/use-chat'
import { useTracks } from '@/hooks/use-tracks'
import { subscribeSSE } from '@/lib/sse'
import { ChatMessages } from './chat-messages'
import { ChatInput } from './chat-input'

const SUGGESTIONS = [
  'What genres are in my collection?',
  'Find me some uplifting house tracks',
  'Create a playlist of 90s hip-hop',
]

export function ChatTab() {
  const store = useChatStore()
  const sendMessage = useSendMessage()
  const stopMutation = useChatStop()
  const clearMutation = useChatClear()
  const { data: history } = useChatHistory()
  const { data: tracks } = useTracks()
  const queryClient = useQueryClient()
  const unsubRef = useRef<(() => void) | null>(null)
  const historyLoaded = useRef(false)

  // Restore history on mount
  useEffect(() => {
    if (history && !historyLoaded.current && history.messages.length > 0) {
      historyLoaded.current = true
      store.setMessages(
        history.messages.map((m) => ({
          id: '',
          role: m.role as 'user' | 'assistant' | 'system',
          text: m.text,
        })),
      )
    }
  }, [history, store])

  const handleSend = useCallback(
    (text: string) => {
      store.addUserMessage(text)
      store.startAssistantMessage()

      sendMessage.mutate(text, {
        onSuccess: () => {
          unsubRef.current = subscribeSSE(
            '/api/chat/progress',
            (event) => {
              switch (event.event) {
                case 'token':
                  store.appendToken(event.text ?? '')
                  break
                case 'tool_call':
                  store.addToolCall(event.tool ?? '', getToolLabel(event.tool ?? ''))
                  break
                case 'tool_result':
                  store.completeToolCall(event.tool ?? '', event.result_summary ?? 'done')
                  break
                case 'done':
                  store.finishAssistantMessage()
                  break
                case 'error':
                  store.finishAssistantMessage()
                  store.addSystemMessage(`Error: ${event.detail ?? 'Unknown error'}`)
                  break
                case 'stopped':
                  store.finishAssistantMessage()
                  store.addSystemMessage('Response stopped.')
                  break
              }
            },
            () => {
              queryClient.invalidateQueries({ queryKey: ['chat-history'] })
            },
          )
        },
        onError: (err) => {
          store.finishAssistantMessage()
          store.addSystemMessage(err instanceof Error ? err.message : 'Failed to send message')
        },
      })
    },
    [store, sendMessage, queryClient],
  )

  const handleStop = useCallback(() => {
    stopMutation.mutate()
    unsubRef.current?.()
    unsubRef.current = null
  }, [stopMutation])

  const handleClear = useCallback(() => {
    clearMutation.mutate(undefined, {
      onSuccess: () => {
        store.clearMessages()
        historyLoaded.current = false
      },
    })
  }, [clearMutation, store])

  const handleSuggestion = useCallback(
    (text: string) => {
      handleSend(text)
    },
    [handleSend],
  )

  const hasData = tracks != null && tracks.length > 0

  if (!hasData) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">No tracks loaded. Upload a CSV in the Tagger tab.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
        <ChatMessages
          messages={store.messages}
          isStreaming={store.isStreaming}
          showWelcome={store.showWelcome}
          suggestions={SUGGESTIONS}
          onSuggestion={handleSuggestion}
        />
        <ChatInput
          isStreaming={store.isStreaming}
          onSend={handleSend}
          onStop={handleStop}
          onClear={handleClear}
        />
      </div>
    </div>
  )
}
