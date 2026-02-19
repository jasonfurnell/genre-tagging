import { useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SetCard } from './set-card'
import { useSavedSets, useDeleteSet } from '@/hooks/use-sets'
import { useUiStore } from '@/stores/ui'

export function SetsTab() {
  const { data: sets, isLoading } = useSavedSets()
  const deleteSet = useDeleteSet()

  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const handleLoad = useCallback(
    (id: string) => {
      // TODO: When Set Workshop is migrated to React, this should load the set
      // into workshop state. For now, just navigate to the workshop tab.
      void id
      setActiveTab('set-workshop')
    },
    [setActiveTab],
  )

  const handleExport = useCallback((id: string, name: string) => {
    const safeName = name.replace(/\s+/g, '_')
    fetch(`/api/saved-sets/${id}/export/m3u`)
      .then((res) => {
        if (!res.ok) throw new Error('Export failed')
        return res.blob()
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${safeName}.m3u8`
        a.click()
        URL.revokeObjectURL(url)
        toast.success(`Exported "${name}"`)
      })
      .catch(() => toast.error('Export failed'))
  }, [])

  const handleDelete = useCallback(
    (id: string, name: string) => {
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
      deleteSet.mutate(id, {
        onSuccess: () => toast.success(`Deleted "${name}"`),
        onError: () => toast.error('Delete failed'),
      })
    },
    [deleteSet],
  )

  const handleNewSet = useCallback(() => {
    // Navigate to Set Workshop to start a fresh set
    setActiveTab('set-workshop')
  }, [setActiveTab])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Loading sets...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Saved Sets</h2>
        <Button size="sm" onClick={handleNewSet}>
          New Set
        </Button>
      </div>

      {/* Grid */}
      {!sets || sets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">
            No saved sets yet. Build a set in the Set Workshop and save it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {sets.map((s) => (
            <SetCard
              key={s.id}
              set={s}
              isActive={false}
              onLoad={handleLoad}
              onExport={handleExport}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
