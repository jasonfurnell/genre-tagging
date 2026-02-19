import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SourceBadge } from '@/components/shared'
import { PlaylistTrackTable } from './playlist-track-table'
import {
  usePlaylistDetail,
  useUpdatePlaylist,
  useDeletePlaylist,
  useRemovePlaylistTracks,
} from '@/hooks/use-playlists'
import { usePlaylistsStore } from '@/stores/playlists'

export function PlaylistDetail() {
  const selectedId = usePlaylistsStore((s) => s.selectedPlaylistId)
  const setSelectedId = usePlaylistsStore((s) => s.setSelectedPlaylistId)

  const { data, isLoading } = usePlaylistDetail(selectedId)
  const updatePlaylist = useUpdatePlaylist()
  const deletePlaylist = useDeletePlaylist()
  const removeTrack = useRemovePlaylistTracks()

  // Track editing name with last-seen server name to reset on playlist switch
  const [editingName, setEditingName] = useState('')
  const lastServerName = useRef('')
  const nameRef = useRef<HTMLInputElement>(null)

  const serverName = data?.playlist.name ?? ''
  if (serverName !== lastServerName.current) {
    lastServerName.current = serverName
    setEditingName(serverName)
  }

  const handleNameBlur = useCallback(() => {
    if (!selectedId || !data || editingName.trim() === data.playlist.name) return
    updatePlaylist.mutate(
      { id: selectedId, name: editingName.trim() },
      { onError: () => toast.error('Failed to rename playlist') },
    )
  }, [selectedId, data, editingName, updatePlaylist])

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      nameRef.current?.blur()
    }
  }, [])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    deletePlaylist.mutate(selectedId, {
      onSuccess: () => {
        toast.success('Playlist deleted')
        setSelectedId(null)
      },
      onError: () => toast.error('Delete failed'),
    })
  }, [selectedId, deletePlaylist, setSelectedId])

  const handleExport = useCallback(
    (format: 'm3u' | 'csv') => {
      if (!selectedId || !data) return
      const safeName = data.playlist.name.replace(/\s+/g, '_')
      const ext = format === 'm3u' ? 'm3u8' : 'csv'
      fetch(`/api/workshop/playlists/${selectedId}/export/${format}`)
        .then((res) => {
          if (!res.ok) throw new Error('Export failed')
          return res.blob()
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${safeName}.${ext}`
          a.click()
          URL.revokeObjectURL(url)
          toast.success(`Exported "${data.playlist.name}"`)
        })
        .catch(() => toast.error('Export failed'))
    },
    [selectedId, data],
  )

  const handleRemoveTrack = useCallback(
    (trackId: number) => {
      if (!selectedId) return
      removeTrack.mutate(
        { id: selectedId, track_ids: [trackId] },
        { onError: () => toast.error('Failed to remove track') },
      )
    },
    [selectedId, removeTrack],
  )

  if (!selectedId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Select a playlist to view details</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-[300px] w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Playlist not found</p>
      </div>
    )
  }

  const { playlist, tracks } = data

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-2 px-4 pt-3">
        <div className="flex items-center gap-3">
          <Input
            ref={nameRef}
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            className="h-8 max-w-sm text-sm font-semibold"
          />
          <Badge variant="secondary" className="shrink-0 text-xs">
            {tracks.length} tracks
          </Badge>
          <SourceBadge source={playlist.source} />
        </div>

        {playlist.description && (
          <p className="text-muted-foreground text-xs">{playlist.description}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport('m3u')}>Export M3U8</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" className="h-7 text-xs">
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete playlist?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{playlist.name}&quot;. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Separator className="my-3" />

      {/* Track table */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        <PlaylistTrackTable tracks={tracks} onRemoveTrack={handleRemoveTrack} />
      </div>
    </div>
  )
}
