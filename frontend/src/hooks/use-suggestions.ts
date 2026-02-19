import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { SuggestResponse } from '@/schemas'
import type { PlaylistFilters } from '@/schemas'

export type SuggestMode = 'explore' | 'vibe' | 'seed' | 'intersection' | 'chord-intersection'

export interface SuggestParams {
  mode: SuggestMode
  num_suggestions?: number
  vibe_text?: string
  seed_track_ids?: number[]
  genre1?: string
  genre2?: string
  lineage1_title?: string
  lineage2_title?: string
  lineage1_filters?: PlaylistFilters
  lineage2_filters?: PlaylistFilters
}

export function useSuggest() {
  return useMutation({
    mutationFn: (params: SuggestParams) =>
      api
        .post('/api/workshop/suggest', params)
        .then(api.validated(SuggestResponse))
        .then((r) => r.suggestions),
  })
}
