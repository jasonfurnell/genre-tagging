import { z } from 'zod'

// ── Track & Slot schemas ────────────────────────────────────

export const TrackOption = z.object({
  id: z.number(),
  title: z.string(),
  artist: z.string(),
  bpm: z.number().nullable().optional(),
  key: z.string().nullable().optional(),
  year: z.union([z.number(), z.string()]).nullable().optional(),
  has_audio: z.boolean().optional().default(false),
  bpm_level: z.number().nullable().optional(),
})

export const SlotSource = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  tree_type: z.string().nullable().optional(),
  description: z.string().optional(),
  track_count: z.number().optional(),
})

export const SetSlot = z.object({
  id: z.string(),
  source: SlotSource.nullable().optional(),
  tracks: z.array(TrackOption.nullable()),
  selectedTrackIndex: z.number().nullable().optional(),
})

// ── API response schemas ────────────────────────────────────

export const AssignSourceResponse = z.object({
  source: SlotSource,
  tracks: z.array(TrackOption.nullable()),
})

export const BrowseSourcesResponse = z.object({
  playlists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      track_count: z.number().optional(),
    }),
  ),
  collection_leaves: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      title: z.string().optional(),
      track_count: z.number().optional(),
    }),
  ),
})

export const SourceDetailResponse = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  track_count: z.number().optional(),
  tracks: z.array(TrackOption),
})

export const TrackSearchResponse = z.object({
  tracks: z.array(
    z.object({
      id: z.number(),
      title: z.string().optional(),
      artist: z.string().optional(),
      bpm: z.number().nullable().optional(),
      key: z.string().nullable().optional(),
      year: z.union([z.number(), z.string()]).nullable().optional(),
      comment: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
    }),
  ),
  count: z.number(),
})

export const TrackContextResponse = z.object({
  collection_leaf: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      name: z.string().optional(),
    })
    .nullable()
    .optional(),
  also_in: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  comment: z.string().nullable().optional(),
})

export const WorkshopStateResponse = z
  .object({
    slots: z.array(z.record(z.string(), z.unknown())).optional(),
    set_id: z.string().nullable().optional(),
    set_name: z.string().nullable().optional(),
    phase_profile_id: z.string().nullable().optional(),
  })
  .nullable()

// ── Types ───────────────────────────────────────────────────

export type TrackOption = z.infer<typeof TrackOption>
export type SlotSource = z.infer<typeof SlotSource>
export type SetSlot = z.infer<typeof SetSlot>
export type AssignSourceResponse = z.infer<typeof AssignSourceResponse>
export type BrowseSourcesResponse = z.infer<typeof BrowseSourcesResponse>
export type SourceDetailResponse = z.infer<typeof SourceDetailResponse>
export type TrackSearchResponse = z.infer<typeof TrackSearchResponse>
export type TrackContextResponse = z.infer<typeof TrackContextResponse>
export type WorkshopStateResponse = z.infer<typeof WorkshopStateResponse>
