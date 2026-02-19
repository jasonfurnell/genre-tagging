import { z } from 'zod'

export const TrackRow = z.object({
  id: z.number(),
  title: z.string(),
  artist: z.string(),
  album_title: z.string().nullable().optional(),
  bpm: z.number().nullable().optional(),
  key: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  comment: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  genre1: z.string().nullable().optional(),
  genre2: z.string().nullable().optional(),
  descriptors: z.string().nullable().optional(),
  mood: z.string().nullable().optional(),
  track_location: z.string().nullable().optional(),
  era: z.string().nullable().optional(),
})

export const TrackSearchResult = TrackRow.extend({
  score: z.number().nullable().optional(),
  matched: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const TagSingleResponse = z.object({
  id: z.number(),
  comment: z.string(),
  year: z.number().nullable().optional(),
})

export type TrackRow = z.infer<typeof TrackRow>
export type TrackSearchResult = z.infer<typeof TrackSearchResult>
export type TagSingleResponse = z.infer<typeof TagSingleResponse>
