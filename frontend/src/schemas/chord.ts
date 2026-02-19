import { z } from 'zod'
import { PlaylistFilters } from './playlist'

export const ChordLineage = z.object({
  title: z.string(),
  track_count: z.number(),
  filters: PlaylistFilters,
})

export const ChordDataResponse = z.object({
  lineages: z.array(ChordLineage),
  matrix: z.array(z.array(z.number())),
})

export type ChordLineage = z.infer<typeof ChordLineage>
export type ChordDataResponse = z.infer<typeof ChordDataResponse>
