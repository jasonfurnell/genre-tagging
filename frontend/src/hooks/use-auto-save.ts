import { useEffect, useRef } from 'react'
import { useSaveWorkshopState } from './use-workshop'
import { useWorkshopStore } from '@/stores/workshop'

const SAVE_DELAY = 1000

/**
 * Auto-save workshop state 1s after any change to slots, set ID, set name, or phase profile.
 * Uses a ref-based debounce to avoid re-render cascades.
 */
export function useAutoSave() {
  const saveState = useSaveWorkshopState()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const slots = useWorkshopStore((s) => s.slots)
  const currentSetId = useWorkshopStore((s) => s.currentSetId)
  const currentSetName = useWorkshopStore((s) => s.currentSetName)
  const phaseProfileId = useWorkshopStore((s) => s.phaseProfileId)
  const isDirty = useWorkshopStore((s) => s.isDirty)
  const markClean = useWorkshopStore((s) => s.markClean)

  useEffect(() => {
    if (!isDirty) return

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      saveState.mutate(
        {
          slots,
          set_id: currentSetId,
          set_name: currentSetName,
          phase_profile_id: phaseProfileId,
        },
        { onSuccess: () => markClean() },
      )
    }, SAVE_DELAY)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [slots, currentSetId, currentSetName, phaseProfileId, isDirty, saveState, markClean])
}
