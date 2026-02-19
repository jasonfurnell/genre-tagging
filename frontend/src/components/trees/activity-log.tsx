import { useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@/stores/trees'

interface ActivityLogProps {
  entries: LogEntry[]
}

export function ActivityLog({ entries }: ActivityLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  if (entries.length === 0) return null

  return (
    <div className="mt-2">
      <div
        ref={scrollRef}
        className="bg-background/50 max-h-36 overflow-y-auto rounded border border-border/50 font-mono"
      >
        {entries.map((entry, i) => (
          <div
            key={i}
            className={cn(
              'px-2.5 py-0.5 text-[0.7rem]',
              entry.isError ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            <span className="mr-2 opacity-50">{entry.timestamp}</span>
            {entry.detail}
          </div>
        ))}
      </div>
    </div>
  )
}
