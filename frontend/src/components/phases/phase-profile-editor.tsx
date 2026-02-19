import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { PhasePreviewBar } from './phase-preview-bar'
import { PhaseTable } from './phase-table'
import { usePhasesStore } from '@/stores/phases'
import { useUiStore } from '@/stores/ui'
import {
  usePhaseProfile,
  useCreatePhaseProfile,
  useUpdatePhaseProfile,
  useDeletePhaseProfile,
  useDuplicatePhaseProfile,
} from '@/hooks/use-phases'

export function PhaseProfileEditor() {
  const selectedId = usePhasesStore((s) => s.selectedProfileId)
  const isNewProfile = usePhasesStore((s) => s.isNewProfile)
  const editingName = usePhasesStore((s) => s.editingName)
  const setEditingName = usePhasesStore((s) => s.setEditingName)
  const editingDescription = usePhasesStore((s) => s.editingDescription)
  const setEditingDescription = usePhasesStore((s) => s.setEditingDescription)
  const editingPhases = usePhasesStore((s) => s.editingPhases)
  const addPhase = usePhasesStore((s) => s.addPhase)
  const loadProfile = usePhasesStore((s) => s.loadProfile)
  const setSelectedProfileId = usePhasesStore((s) => s.setSelectedProfileId)
  const setIsNewProfile = usePhasesStore((s) => s.setIsNewProfile)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const { data: profile } = usePhaseProfile(selectedId)
  const createProfile = useCreatePhaseProfile()
  const updateProfile = useUpdatePhaseProfile()
  const deleteProfile = useDeletePhaseProfile()
  const duplicateProfile = useDuplicatePhaseProfile()

  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)
  const [duplicateName, setDuplicateName] = useState('')

  // Load profile data into editing state when selected profile changes
  useEffect(() => {
    if (profile && !isNewProfile) {
      loadProfile(profile.name, profile.description, profile.phases)
    }
  }, [profile, isNewProfile, loadProfile])

  const isDefault = profile?.is_default ?? false
  const readOnly = isDefault && !isNewProfile

  const handleSave = useCallback(() => {
    const name = editingName.trim()
    if (!name) {
      toast.error('Profile name is required')
      return
    }
    const phases = editingPhases.map((p) => ({
      name: p.name.trim(),
      pct: [p.pct[0], p.pct[1]] as [number, number],
      desc: p.desc.trim(),
      color: p.color,
    }))

    if (isNewProfile) {
      createProfile.mutate(
        { name, description: editingDescription.trim(), phases },
        {
          onSuccess: (data) => {
            toast.success(`Created "${data.name}"`)
            setSelectedProfileId(data.id)
            setIsNewProfile(false)
          },
          onError: (err) => toast.error(err.message || 'Failed to create profile'),
        },
      )
    } else if (selectedId) {
      updateProfile.mutate(
        { id: selectedId, name, description: editingDescription.trim(), phases },
        {
          onSuccess: () => toast.success(`Saved "${name}"`),
          onError: (err) => toast.error(err.message || 'Failed to save profile'),
        },
      )
    }
  }, [
    editingName,
    editingDescription,
    editingPhases,
    isNewProfile,
    selectedId,
    createProfile,
    updateProfile,
    setSelectedProfileId,
    setIsNewProfile,
  ])

  const handleDelete = useCallback(() => {
    if (!selectedId || isDefault) return
    if (!confirm(`Delete "${editingName}"? This cannot be undone.`)) return
    deleteProfile.mutate(selectedId, {
      onSuccess: () => {
        toast.success(`Deleted "${editingName}"`)
        setSelectedProfileId(null)
      },
      onError: () => toast.error('Failed to delete profile'),
    })
  }, [selectedId, isDefault, editingName, deleteProfile, setSelectedProfileId])

  const handleDuplicate = useCallback(() => {
    if (!selectedId) return
    setDuplicateName(`${editingName} (Copy)`)
    setShowDuplicateDialog(true)
  }, [selectedId, editingName])

  const handleDuplicateConfirm = useCallback(() => {
    const name = duplicateName.trim()
    if (!name || !selectedId) return
    duplicateProfile.mutate(
      { id: selectedId, name },
      {
        onSuccess: (data) => {
          toast.success(`Duplicated as "${data.name}"`)
          setSelectedProfileId(data.id)
          setShowDuplicateDialog(false)
        },
        onError: () => toast.error('Failed to duplicate profile'),
      },
    )
  }, [duplicateName, selectedId, duplicateProfile, setSelectedProfileId])

  const handleApply = useCallback(() => {
    // Navigate to Set Workshop — workshop will read active phase profile from store
    toast.success(`Applied "${editingName}" to Set Workshop`)
    setActiveTab('set-workshop')
  }, [editingName, setActiveTab])

  // No profile selected and not creating new
  if (!selectedId && !isNewProfile) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Select a profile or create a new one</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
      {/* Name + Default badge */}
      <div className="flex items-center gap-3">
        <Input
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          disabled={readOnly}
          className="max-w-sm text-sm font-medium"
          placeholder="Profile name"
        />
        {isDefault && (
          <Badge variant="secondary" className="shrink-0">
            Default
          </Badge>
        )}
      </div>

      {/* Description */}
      <Textarea
        value={editingDescription}
        onChange={(e) => setEditingDescription(e.target.value)}
        disabled={readOnly}
        className="max-w-2xl resize-none text-xs"
        rows={2}
        placeholder="Description (optional)"
      />

      {/* Live preview bar */}
      <PhasePreviewBar phases={editingPhases} />

      {/* Phase table header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Phases</span>
        {!readOnly && (
          <Button variant="outline" size="sm" onClick={addPhase}>
            + Add Phase
          </Button>
        )}
      </div>

      {/* Phase rows */}
      <PhaseTable readOnly={readOnly} />

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={handleApply}>
          Apply to Set Workshop
        </Button>
        <Button size="sm" variant="outline" onClick={handleDuplicate}>
          Duplicate
        </Button>
        {!readOnly && (
          <>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={createProfile.isPending || updateProfile.isPending}
            >
              {createProfile.isPending || updateProfile.isPending ? 'Saving...' : 'Save'}
            </Button>
            {!isNewProfile && (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteProfile.isPending}
              >
                Delete
              </Button>
            )}
          </>
        )}
      </div>

      {/* Duplicate dialog */}
      <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Duplicate Profile</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Input
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDuplicateConfirm()}
              placeholder="New profile name"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDuplicateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleDuplicateConfirm}
              disabled={!duplicateName.trim() || duplicateProfile.isPending}
            >
              {duplicateProfile.isPending ? 'Duplicating...' : 'Duplicate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
