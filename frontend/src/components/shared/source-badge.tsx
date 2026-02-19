import { Badge } from '@/components/ui/badge'

const SOURCE_CONFIG: Record<string, { label: string; className: string }> = {
  llm: { label: 'AI', className: 'bg-purple-600/20 text-purple-300 border-purple-600/30' },
  import: { label: 'Import', className: 'bg-blue-600/20 text-blue-300 border-blue-600/30' },
  tree: { label: 'Tree', className: 'bg-green-600/20 text-green-300 border-green-600/30' },
  'scene-tree': { label: 'Scene', className: 'bg-teal-600/20 text-teal-300 border-teal-600/30' },
  'collection-tree': {
    label: 'Collection',
    className: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/30',
  },
  chat: { label: 'Chat', className: 'bg-amber-600/20 text-amber-300 border-amber-600/30' },
  manual: { label: 'Manual', className: 'bg-zinc-600/20 text-zinc-300 border-zinc-600/30' },
}

export function SourceBadge({ source }: { source: string }) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.manual
  return (
    <Badge variant="outline" className={`text-[10px] ${config.className}`}>
      {config.label}
    </Badge>
  )
}
