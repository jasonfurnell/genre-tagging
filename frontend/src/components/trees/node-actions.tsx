import { useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useCreateTreePlaylist, exportM3uUrl } from '@/hooks/use-trees'
import { useTreesStore } from '@/stores/trees'
import type { TreeType } from '@/schemas'

interface NodeActionsProps {
  nodeId: string
  type: TreeType
  nodeTitle: string
  trackCount: number
}

export function NodeActions({ nodeId, type, nodeTitle, trackCount }: NodeActionsProps) {
  const createPlaylist = useCreateTreePlaylist(type)
  const markCreated = useTreesStore((s) => s.markPlaylistCreated)
  const createdIds = useTreesStore((s) => s.createdPlaylistNodeIds[type])
  const isCreated = createdIds.has(nodeId)

  const handleExportM3u = useCallback(() => {
    const url = exportM3uUrl(type, nodeId)
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Export failed')
        return res.blob()
      })
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${nodeTitle.replace(/\s+/g, '_')}.m3u8`
        a.click()
        URL.revokeObjectURL(a.href)
        toast.success(`Exported "${nodeTitle}"`)
      })
      .catch(() => toast.error('Export failed'))
  }, [type, nodeId, nodeTitle])

  const handleCreatePlaylist = useCallback(() => {
    createPlaylist.mutate(nodeId, {
      onSuccess: () => {
        markCreated(type, nodeId)
        toast.success(`Created playlist "${nodeTitle}"`)
      },
      onError: () => toast.error('Failed to create playlist'),
    })
  }, [createPlaylist, nodeId, type, nodeTitle, markCreated])

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        className="h-6 px-2 text-[0.65rem]"
        onClick={handleExportM3u}
      >
        M3U8
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="h-6 px-2 text-[0.65rem]"
        onClick={handleCreatePlaylist}
        disabled={isCreated || createPlaylist.isPending}
      >
        {isCreated ? 'Created' : createPlaylist.isPending ? 'Creating...' : 'Create Playlist'}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="h-6 px-2 text-[0.65rem]"
        disabled
        title="Available when Set Workshop is migrated"
      >
        Push to Workshop
      </Button>
      <span className="text-muted-foreground ml-auto text-[0.65rem]">{trackCount} tracks</span>
    </div>
  )
}
