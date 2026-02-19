import { useCallback, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

// Module-level singleton audio element
let audioEl: HTMLAudioElement | null = null
let currentKey: string | null = null
let onEndedCallbacks: Array<() => void> = []

function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.volume = 0.7
  }
  return audioEl
}

interface PreviewButtonProps {
  artist: string
  title: string
  className?: string
}

export function PreviewButton({ artist, title, className }: PreviewButtonProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const key = `${artist}||${title}`

  useEffect(() => {
    // Sync state if another PreviewButton takes over playback
    const handleEnded = () => {
      if (currentKey === key) setIsPlaying(false)
    }
    onEndedCallbacks.push(handleEnded)
    return () => {
      onEndedCallbacks = onEndedCallbacks.filter((cb) => cb !== handleEnded)
    }
  }, [key])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const audio = getAudio()

      if (currentKey === key && !audio.paused) {
        audio.pause()
        currentKey = null
        setIsPlaying(false)
        return
      }

      // Stop any current playback
      if (currentKey && currentKey !== key) {
        audio.pause()
        onEndedCallbacks.forEach((cb) => cb())
      }

      const src = `/api/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`
      audio.src = src
      audio.play().catch(() => setIsPlaying(false))
      currentKey = key
      setIsPlaying(true)

      audio.onended = () => {
        currentKey = null
        setIsPlaying(false)
        onEndedCallbacks.forEach((cb) => cb())
      }
    },
    [artist, title, key],
  )

  return (
    <button
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs transition-colors',
        isPlaying
          ? 'bg-primary/20 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
      onClick={handleClick}
      title="Play 30s preview"
    >
      {isPlaying ? '⏸' : '▶'}
    </button>
  )
}
