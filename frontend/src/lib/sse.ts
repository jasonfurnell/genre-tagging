import type { ProgressEvent } from '@/schemas'

export function subscribeSSE(
  url: string,
  onEvent: (event: ProgressEvent) => void,
  onDone?: () => void,
): () => void {
  const source = new EventSource(url)

  const handler = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as ProgressEvent
      onEvent(data)
      if (data.event === 'done' || data.event === 'error' || data.event === 'stopped') {
        source.close()
        onDone?.()
      }
    } catch {
      // ignore parse errors
    }
  }

  source.addEventListener('message', handler)
  source.addEventListener('progress', handler)
  source.addEventListener('done', handler)
  source.addEventListener('error', () => {
    source.close()
    onDone?.()
  })

  return () => source.close()
}
