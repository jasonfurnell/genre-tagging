import { useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useImportPlaylist } from '@/hooks/use-playlists'
import { usePlaylistsStore } from '@/stores/playlists'

export function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const importPlaylist = useImportPlaylist()
  const setSelectedPlaylistId = usePlaylistsStore((s) => s.setSelectedPlaylistId)

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      importPlaylist.mutate(file, {
        onSuccess: (data) => {
          const result = data as {
            playlist: { id: string; name: string }
            matched_count: number
            unmatched_count: number
          }
          toast.success(
            `Imported "${result.playlist.name}" — ${result.matched_count} matched, ${result.unmatched_count} unmatched`,
          )
          setSelectedPlaylistId(result.playlist.id)
        },
        onError: (err) => toast.error(`Import failed: ${err.message}`),
      })

      // Reset the input so the same file can be re-imported
      e.target.value = ''
    },
    [importPlaylist, setSelectedPlaylistId],
  )

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleClick} disabled={importPlaylist.isPending}>
        {importPlaylist.isPending ? 'Importing...' : 'Import M3U'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".m3u,.m3u8"
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  )
}
