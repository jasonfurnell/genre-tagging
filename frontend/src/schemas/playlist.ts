import { z } from 'zod'
import { TrackRow } from './track'

// --- Filters ---
export const PlaylistFilters = z.object({
  genres: z.array(z.string()).optional(),
  mood: z.union([z.array(z.string()), z.string()]).optional(),
  descriptors: z.array(z.string()).optional(),
  location: z.array(z.string()).optional(),
  era: z.array(z.string()).optional(),
  bpm_min: z.number().optional(),
  bpm_max: z.number().optional(),
  year_min: z.number().optional(),
  year_max: z.number().optional(),
  text_search: z.string().optional(),
})

// --- Playlist ---
export const Playlist = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  filters: PlaylistFilters.nullable().optional(),
  track_ids: z.array(z.number()),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const PlaylistListResponse = z.object({
  playlists: z.array(Playlist),
})

export const PlaylistDetailResponse = z.object({
  playlist: Playlist,
  tracks: z.array(TrackRow),
})

// --- Suggestions ---
export const SampleTrack = z.object({
  id: z.number(),
  title: z.string(),
  artist: z.string(),
  year: z.union([z.string(), z.number()]).nullable().optional(),
  score: z.number().optional(),
})

export const Suggestion = z.object({
  name: z.string(),
  description: z.string(),
  filters: PlaylistFilters.optional(),
  rationale: z.string().optional(),
  track_count: z.number().optional(),
  sample_tracks: z.array(SampleTrack).optional(),
})

export const SuggestResponse = z.object({
  suggestions: z.array(Suggestion),
})

// --- Smart create ---
export const SmartCreateResponse = z.object({
  playlist: Playlist,
  method: z.string().optional(),
})

// --- Import ---
export const ImportResponse = z.object({
  playlist: Playlist,
  matched_count: z.number(),
  unmatched_count: z.number(),
  unmatched_tracks: z.array(z.string()),
})

// --- Types ---
export type PlaylistFilters = z.infer<typeof PlaylistFilters>
export type Playlist = z.infer<typeof Playlist>
export type PlaylistListResponse = z.infer<typeof PlaylistListResponse>
export type PlaylistDetailResponse = z.infer<typeof PlaylistDetailResponse>
export type SampleTrack = z.infer<typeof SampleTrack>
export type Suggestion = z.infer<typeof Suggestion>
export type SuggestResponse = z.infer<typeof SuggestResponse>
export type SmartCreateResponse = z.infer<typeof SmartCreateResponse>
export type ImportResponse = z.infer<typeof ImportResponse>
