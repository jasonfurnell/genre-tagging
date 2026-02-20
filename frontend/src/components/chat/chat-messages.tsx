import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ChatMessage, ToolCall } from '@/stores/chat'

interface ChatMessagesProps {
  messages: ChatMessage[]
  isStreaming: boolean
  showWelcome: boolean
  suggestions: string[]
  onSuggestion: (text: string) => void
}

export function ChatMessages({
  messages,
  isStreaming,
  showWelcome,
  suggestions,
  onSuggestion,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages or streaming tokens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {showWelcome && messages.length === 0 && (
        <div className="my-auto text-center">
          <h3 className="mb-2 text-lg font-semibold">Music Collection Chat</h3>
          <p className="text-muted-foreground mb-4 text-sm">
            Ask questions about your collection, search for tracks, or create playlists using
            natural language.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                className="text-muted-foreground hover:text-foreground hover:border-primary rounded-full border border-border bg-card px-3 py-1.5 text-xs transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          showCursor={isStreaming && msg.role === 'assistant' && i === messages.length - 1}
        />
      ))}

      <div ref={bottomRef} />
    </div>
  )
}

function MessageBubble({ message, showCursor }: { message: ChatMessage; showCursor: boolean }) {
  const { role, text, toolCalls } = message

  return (
    <div
      className={cn(
        'flex',
        role === 'user' && 'justify-end',
        role === 'system' && 'justify-center',
      )}
    >
      <div
        className={cn(
          'rounded-lg px-3 py-2 text-sm leading-relaxed',
          role === 'user' && 'max-w-[75%] rounded-br-sm bg-accent/20',
          role === 'assistant' && 'max-w-[85%] rounded-bl-sm border border-border bg-card',
          role === 'system' && 'text-muted-foreground text-xs italic',
        )}
      >
        {/* Tool call indicators */}
        {toolCalls?.map((tc, i) => (
          <ToolCallIndicator key={i} toolCall={tc} />
        ))}

        {/* Message text */}
        <span className="whitespace-pre-wrap break-words">{text}</span>

        {/* Streaming cursor */}
        {showCursor && (
          <span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-primary align-text-bottom" />
        )}
      </div>
    </div>
  )
}

function ToolCallIndicator({ toolCall }: { toolCall: ToolCall }) {
  return (
    <div className="my-1 flex items-center gap-1.5 rounded bg-background px-2 py-1 text-xs">
      <span className="text-muted-foreground">⚙</span>
      <span className="text-muted-foreground">{toolCall.label}</span>
      <span
        className={cn(
          'ml-auto text-[0.65rem]',
          toolCall.status === 'done' ? 'text-emerald-400' : 'text-muted-foreground',
        )}
      >
        {toolCall.status === 'done' ? (toolCall.summary ?? 'done') : 'running…'}
      </span>
    </div>
  )
}
