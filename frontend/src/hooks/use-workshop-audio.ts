import { useCallback, useEffect, useRef, useState } from 'react'

interface AudioState {
  isPlaying: boolean
  currentTime: number
  duration: number
  trackId: number | null
}

// Module-level singleton
let workshopAudio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!workshopAudio) {
    workshopAudio = new Audio()
    workshopAudio.volume = 0.8
  }
  return workshopAudio
}

/**
 * Hook for full-track audio playback in Set Workshop.
 * Uses a module-level singleton Audio element.
 */
export function useWorkshopAudio() {
  const [state, setState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    trackId: null,
  })
  const rafRef = useRef<number>(0)
  const onEndedRef = useRef<(() => void) | null>(null)
  const tickingRef = useRef(false)

  // Progress ticker using ref-based loop (avoids self-referencing useCallback)
  const startTicking = useCallback(() => {
    if (tickingRef.current) return
    tickingRef.current = true

    function tick() {
      if (!tickingRef.current) return
      const audio = getAudio()
      setState((prev) => ({
        ...prev,
        currentTime: audio.currentTime,
        duration: audio.duration || 0,
        isPlaying: !audio.paused,
      }))
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const stopTicking = useCallback(() => {
    tickingRef.current = false
    cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    return () => {
      tickingRef.current = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const play = useCallback(
    (trackId: number, onEnded?: () => void) => {
      const audio = getAudio()
      audio.pause()
      stopTicking()

      audio.src = `/audio/${trackId}`
      audio.currentTime = 0
      onEndedRef.current = onEnded ?? null

      audio.onended = () => {
        setState((prev) => ({ ...prev, isPlaying: false }))
        stopTicking()
        onEndedRef.current?.()
      }

      audio.onerror = () => {
        setState((prev) => ({ ...prev, isPlaying: false }))
        stopTicking()
        onEndedRef.current?.()
      }

      audio.play().catch(() => {
        setState((prev) => ({ ...prev, isPlaying: false }))
      })

      setState({ isPlaying: true, currentTime: 0, duration: 0, trackId })
      startTicking()
    },
    [startTicking, stopTicking],
  )

  const pause = useCallback(() => {
    const audio = getAudio()
    audio.pause()
    stopTicking()
    setState((prev) => ({ ...prev, isPlaying: false }))
  }, [stopTicking])

  const resume = useCallback(() => {
    const audio = getAudio()
    audio.play().catch(() => {})
    setState((prev) => ({ ...prev, isPlaying: true }))
    startTicking()
  }, [startTicking])

  const togglePause = useCallback(() => {
    const audio = getAudio()
    if (audio.paused) {
      resume()
    } else {
      pause()
    }
  }, [pause, resume])

  const stop = useCallback(() => {
    const audio = getAudio()
    audio.pause()
    audio.src = ''
    stopTicking()
    setState({ isPlaying: false, currentTime: 0, duration: 0, trackId: null })
  }, [stopTicking])

  const seek = useCallback((time: number) => {
    const audio = getAudio()
    audio.currentTime = time
    setState((prev) => ({ ...prev, currentTime: time }))
  }, [])

  return { ...state, play, pause, resume, togglePause, stop, seek }
}
