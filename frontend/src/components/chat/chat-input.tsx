import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

interface ChatInputProps {
  isStreaming: boolean
  onSend: (text: string) => void
  onStop: () => void
  onClear: () => void
}

export function ChatInput({ isStreaming, onSend, onStop, onClear }: ChatInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, isStreaming, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="flex items-end gap-2 border-t border-border bg-card px-4 py-3">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your music collection..."
        rows={1}
        className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:border-primary focus:outline-none"
        style={{ maxHeight: 120 }}
        disabled={isStreaming}
      />
      <div className="flex gap-1.5">
        {isStreaming ? (
          <Button size="sm" variant="outline" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={handleSend} disabled={!text.trim()}>
            Send
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClear} disabled={isStreaming}>
          Clear
        </Button>
      </div>
    </div>
  )
}
