import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PlaylistSidebar } from './playlist-sidebar'
import { PlaylistDetail } from './playlist-detail'
import { SuggestionSection } from './suggestion-section'
import { ImportButton } from './import-button'
import { usePlaylists, useCreatePlaylist } from '@/hooks/use-playlists'
import { usePlaylistsStore } from '@/stores/playlists'

export function PlaylistsTab() {
  const { data: playlists, isLoading } = usePlaylists()
  const createPlaylist = useCreatePlaylist()
  const setSelectedPlaylistId = usePlaylistsStore((s) => s.setSelectedPlaylistId)

  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newName, setNewName] = useState('')

  const handleCreate = useCallback(() => {
    const name = newName.trim()
    if (!name) return
    createPlaylist.mutate(
      { name },
      {
        onSuccess: (data) => {
          toast.success(`Created "${data.playlist.name}"`)
          setSelectedPlaylistId(data.playlist.id)
          setShowNewDialog(false)
          setNewName('')
        },
        onError: () => toast.error('Failed to create playlist'),
      },
    )
  }, [newName, createPlaylist, setSelectedPlaylistId])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">Playlists</h2>
        <div className="flex items-center gap-2">
          <ImportButton />
          <Button size="sm" onClick={() => setShowNewDialog(true)}>
            New Playlist
          </Button>
        </div>
      </div>

      {/* Main area: sidebar + detail */}
      <div className="flex flex-1 overflow-hidden">
        <PlaylistSidebar playlists={playlists} isLoading={isLoading} />
        <PlaylistDetail />
      </div>

      {/* Suggestions */}
      <SuggestionSection />

      {/* New playlist dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Playlist</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="playlist-name">Name</Label>
            <Input
              id="playlist-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="My Playlist"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createPlaylist.isPending}>
              {createPlaylist.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
