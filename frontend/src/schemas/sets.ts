import { z } from 'zod'

export const SavedSetSummary = z.object({
  id: z.string(),
  name: z.string(),
  track_count: z.number(),
  slot_count: z.number(),
  duration_minutes: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const SavedSetListResponse = z.object({
  sets: z.array(SavedSetSummary),
})

export const SavedSetDetail = z.object({
  id: z.string(),
  name: z.string(),
  slots: z.array(z.record(z.string(), z.unknown())),
  created_at: z.string(),
  updated_at: z.string(),
})

export type SavedSetSummary = z.infer<typeof SavedSetSummary>
export type SavedSetListResponse = z.infer<typeof SavedSetListResponse>
export type SavedSetDetail = z.infer<typeof SavedSetDetail>
