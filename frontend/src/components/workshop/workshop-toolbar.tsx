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
import { useWorkshopStore, type WorkshopMode } from '@/stores/workshop'
import { useCreateSavedSet, useUpdateSavedSet, useExportM3u } from '@/hooks/use-workshop'

interface WorkshopToolbarProps {
  onRefillBpm: () => void
  isRefilling: boolean
}

export function WorkshopToolbar({ onRefillBpm, isRefilling }: WorkshopToolbarProps) {
  const mode = useWorkshopStore((s) => s.mode)
  const setMode = useWorkshopStore((s) => s.setMode)
  const slots = useWorkshopStore((s) => s.slots)
  const currentSetId = useWorkshopStore((s) => s.currentSetId)
  const currentSetName = useWorkshopStore((s) => s.currentSetName)
  const setCurrentSet = useWorkshopStore((s) => s.setCurrentSet)
  const isDirty = useWorkshopStore((s) => s.isDirty)
  const startNewSet = useWorkshopStore((s) => s.startNewSet)
  const openDrawer = useWorkshopStore((s) => s.openDrawer)

  const createSet = useCreateSavedSet()
  const updateSet = useUpdateSavedSet()
  const exportM3u = useExportM3u()

  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')

  const handleSave = useCallback(() => {
    if (!currentSetId) {
      setSaveName(currentSetName ?? '')
      setShowSaveDialog(true)
      return
    }
    updateSet.mutate(
      {
        id: currentSetId,
        name: currentSetName ?? undefined,
        slots: slots as unknown as Record<string, unknown>[],
      },
      {
        onSuccess: () => toast.success('Set saved'),
        onError: () => toast.error('Save failed'),
      },
    )
  }, [currentSetId, currentSetName, slots, updateSet])

  const handleSaveAs = useCallback(() => {
    setSaveName(currentSetName ?? '')
    setShowSaveDialog(true)
  }, [currentSetName])

  const handleSaveConfirm = useCallback(() => {
    const name = saveName.trim()
    if (!name) return
    createSet.mutate(
      { name, slots: slots as unknown as Record<string, unknown>[] },
      {
        onSuccess: (data) => {
          toast.success(`Saved as "${data.name}"`)
          setCurrentSet(data.id, data.name)
          setShowSaveDialog(false)
        },
        onError: () => toast.error('Save failed'),
      },
    )
  }, [saveName, slots, createSet, setCurrentSet])

  const handleExport = useCallback(() => {
    const exportSlots = slots
      .filter((s) => s.selectedTrackIndex != null && s.tracks[s.selectedTrackIndex!])
      .map((s) => {
        const track = s.tracks[s.selectedTrackIndex!]!
        return { track_id: track.id }
      })
    if (exportSlots.length === 0) {
      toast.error('No tracks selected to export')
      return
    }
    const name = currentSetName ?? 'DJ_Set'
    exportM3u.mutate(
      { slots: exportSlots, name },
      {
        onSuccess: (blob) => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${name.replace(/\s+/g, '_')}.m3u8`
          a.click()
          URL.revokeObjectURL(url)
          toast.success('Exported M3U8')
        },
        onError: () => toast.error('Export failed'),
      },
    )
  }, [slots, currentSetName, exportM3u])

  const handleNew = useCallback(() => {
    if (isDirty && !confirm('Start a new set? Unsaved changes will be lost.')) return
    startNewSet()
  }, [isDirty, startNewSet])

  const handleModeToggle = useCallback(
    (m: WorkshopMode) => {
      setMode(m)
      if (m === 'playset') {
        openDrawer('now-playing')
      }
    },
    [setMode, openDrawer],
  )

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">
          {currentSetName ?? 'Set Workshop'}
          {isDirty && <span className="ml-1 text-muted-foreground">*</span>}
        </h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleNew}>
          New
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleSave}>
          Save
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleSaveAs}>
          Save As
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleExport}>
          Export
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onRefillBpm}
          disabled={isRefilling}
        >
          {isRefilling ? 'Refilling...' : 'Refill BPM'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => openDrawer('browse')}
        >
          Browse
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => openDrawer('search')}
        >
          Search
        </Button>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
        <button
          className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
            mode === 'workshop' ? 'bg-background shadow-sm' : 'text-muted-foreground'
          }`}
          onClick={() => handleModeToggle('workshop')}
        >
          Workshop
        </button>
        <button
          className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
            mode === 'playset' ? 'bg-background shadow-sm' : 'text-muted-foreground'
          }`}
          onClick={() => handleModeToggle('playset')}
        >
          Play
        </button>
      </div>

      {/* Save dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save Set As</DialogTitle>
          </DialogHeader>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveConfirm()}
            placeholder="Set name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveConfirm} disabled={!saveName.trim() || createSet.isPending}>
              {createSet.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
