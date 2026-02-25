/**
 * Artwork URL resolution hook with automatic batching.
 *
 * Components call `useArtworkUrl(artist, title)` and get back a URL string
 * (or null while loading). Under the hood, requests are batched: all calls
 * within a 100ms window are collected and sent as a single POST to
 * `/api/artwork/batch`, which is far more efficient than one GET per track.
 *
 * Results are cached in a module-level Map so they survive re-renders and
 * are shared across all component instances.
 */

import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Module-level cache & batch queue (shared across all hook instances)
// ---------------------------------------------------------------------------

interface ArtworkEntry {
  cover_url: string
  cover_big?: string
  found: boolean
}

/** Resolved artwork URLs, keyed by "artist||title" */
const cache = new Map<string, ArtworkEntry>()

/** Pending requests waiting to be batched */
const pending = new Map<
  string,
  { artist: string; title: string; callbacks: Array<(entry: ArtworkEntry) => void> }
>()

let flushTimer: ReturnType<typeof setTimeout> | null = null

const BATCH_DELAY_MS = 100
const MAX_BATCH_SIZE = 50

function cacheKey(artist: string, title: string): string {
  return `${artist.toLowerCase()}||${title.toLowerCase()}`
}

async function flushBatch(): Promise<void> {
  flushTimer = null
  if (pending.size === 0) return

  // Grab current batch and clear pending
  const batch = new Map(pending)
  pending.clear()

  // Split into chunks of MAX_BATCH_SIZE
  const entries = Array.from(batch.entries())
  for (let i = 0; i < entries.length; i += MAX_BATCH_SIZE) {
    const chunk = entries.slice(i, i + MAX_BATCH_SIZE)
    const items = chunk.map(([, { artist, title }]) => ({ artist, title }))

    try {
      const resp = await fetch('/api/artwork/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      })
      if (!resp.ok) throw new Error(`artwork/batch ${resp.status}`)

      const results: Record<string, ArtworkEntry> = await resp.json()

      // Populate cache and notify subscribers
      for (const [key, { callbacks }] of chunk) {
        const entry = results[key] ?? { cover_url: '', found: false }
        cache.set(key, entry)
        for (const cb of callbacks) cb(entry)
      }
    } catch {
      // On error, notify all with empty result so they show placeholder
      for (const [key, { callbacks }] of chunk) {
        const empty: ArtworkEntry = { cover_url: '', found: false }
        cache.set(key, empty)
        for (const cb of callbacks) cb(empty)
      }
    }
  }
}

function requestArtwork(
  artist: string,
  title: string,
  callback: (entry: ArtworkEntry) => void,
): void {
  const key = cacheKey(artist, title)

  // Already cached
  const cached = cache.get(key)
  if (cached !== undefined) {
    callback(cached)
    return
  }

  // Already pending — just add our callback
  const existing = pending.get(key)
  if (existing) {
    existing.callbacks.push(callback)
    return
  }

  // New request — add to pending batch
  pending.set(key, { artist, title, callbacks: [callback] })

  // Schedule flush
  if (!flushTimer) {
    flushTimer = setTimeout(flushBatch, BATCH_DELAY_MS)
  }
}

// ---------------------------------------------------------------------------
// Hook: useArtworkUrl
// ---------------------------------------------------------------------------

/**
 * Returns the resolved artwork URL for a track, or null if not yet loaded.
 * Automatically batches requests with other hook instances.
 */
export function useArtworkUrl(
  artist: string | undefined | null,
  title: string | undefined | null,
  size: 'small' | 'big' = 'small',
): string | null {
  const a = (artist ?? '').trim()
  const t = (title ?? '').trim()
  const key = a && t ? cacheKey(a, t) : ''

  const [url, setUrl] = useState<string | null>(() => {
    if (!key) return null
    const cached = cache.get(key)
    if (cached?.found)
      return size === 'big' ? (cached.cover_big ?? cached.cover_url) : cached.cover_url
    return null
  })

  useEffect(() => {
    if (!key) return

    // Request via batch queue (handles cache-hit synchronously via callback)
    let cancelled = false
    requestArtwork(a, t, (entry) => {
      if (cancelled) return
      const resolved = entry.found
        ? size === 'big'
          ? (entry.cover_big ?? entry.cover_url)
          : entry.cover_url
        : null
      setUrl(resolved)
    })

    return () => {
      cancelled = true
    }
  }, [key, a, t, size])

  if (!key) return null
  return url
}

/**
 * Invalidate the artwork cache (e.g. after warm-cache completes).
 * Forces all mounted components to re-fetch on next render.
 */
export function invalidateArtworkCache(): void {
  cache.clear()
}
