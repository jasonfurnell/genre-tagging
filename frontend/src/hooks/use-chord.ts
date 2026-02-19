import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ChordDataResponse } from '@/schemas'

export const chordKeys = {
  data: (treeType: string, threshold: number, maxLineages: number) =>
    ['chord-data', treeType, threshold, maxLineages] as const,
}

export function useChordData(treeType: string, threshold: number, maxLineages: number) {
  const params = new URLSearchParams({
    tree_type: treeType,
    threshold: String(threshold),
    max_lineages: String(maxLineages),
  })

  return useQuery({
    queryKey: chordKeys.data(treeType, threshold, maxLineages),
    queryFn: () =>
      api.get(`/api/workshop/chord-data?${params}`).then(api.validated(ChordDataResponse)),
    placeholderData: keepPreviousData,
  })
}
