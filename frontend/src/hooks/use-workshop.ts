import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  BrowseSourcesResponse,
  AssignSourceResponse,
  SourceDetailResponse,
  TrackSearchResponse,
  TrackContextResponse,
  WorkshopStateResponse,
  SavedSetListResponse,
  SavedSetDetail,
} from '@/schemas'

export const workshopKeys = {
  sources: (search: string) => ['workshop-sources', search] as const,
  sourceDetail: (type: string, id: string, treeType: string) =>
    ['workshop-source-detail', type, id, treeType] as const,
  trackContext: (id: number) => ['workshop-track-context', id] as const,
  state: ['workshop-state'] as const,
  savedSets: ['saved-sets'] as const,
  savedSet: (id: string) => ['saved-sets', id] as const,
}

// ── Browse sources ──────────────────────────────────────────

export function useWorkshopSources(search: string) {
  return useQuery({
    queryKey: workshopKeys.sources(search),
    queryFn: () =>
      api
        .get(`/api/set-workshop/sources?search=${encodeURIComponent(search)}`)
        .then(api.validated(BrowseSourcesResponse)),
  })
}

// ── Assign source to slot ───────────────────────────────────

export function useAssignSource() {
  return useMutation({
    mutationFn: (body: {
      source_type: string
      source_id: string
      tree_type?: string
      used_track_ids?: number[]
      anchor_track_id?: number | null
      track_ids?: number[]
      name?: string
    }) =>
      api.post('/api/set-workshop/assign-source', body).then(api.validated(AssignSourceResponse)),
  })
}

// ── Drag track into slot ────────────────────────────────────

export function useDragTrack() {
  return useMutation({
    mutationFn: (body: {
      track_id: number | null
      source_type?: string
      source_id?: string
      tree_type?: string
      used_track_ids?: number[]
      track_ids?: number[]
      name?: string
    }) => api.post('/api/set-workshop/drag-track', body).then(api.validated(AssignSourceResponse)),
  })
}

// ── Source detail ────────────────────────────────────────────

export function useSourceDetail(
  sourceType: string | null,
  sourceId: string | null,
  treeType: string | null,
) {
  return useQuery({
    queryKey: workshopKeys.sourceDetail(sourceType ?? '', sourceId ?? '', treeType ?? ''),
    queryFn: () =>
      api
        .get(
          `/api/set-workshop/source-detail?source_type=${sourceType}&source_id=${sourceId}&tree_type=${treeType ?? 'genre'}`,
        )
        .then(api.validated(SourceDetailResponse)),
    enabled: sourceType != null && sourceId != null,
  })
}

// ── Track search ────────────────────────────────────────────

export function useTrackSearch() {
  return useMutation({
    mutationFn: (query: string) =>
      api
        .post('/api/set-workshop/track-search', { query })
        .then(api.validated(TrackSearchResponse)),
  })
}

// ── Track context ───────────────────────────────────────────

export function useTrackContext(trackId: number | null) {
  return useQuery({
    queryKey: workshopKeys.trackContext(trackId ?? 0),
    queryFn: () =>
      api
        .get(`/api/set-workshop/track-context/${trackId}`)
        .then(api.validated(TrackContextResponse)),
    enabled: trackId != null,
  })
}

// ── Check audio availability ────────────────────────────────

export function useCheckAudio() {
  return useMutation({
    mutationFn: (trackIds: number[]) =>
      api.post<Record<string, boolean>>('/api/set-workshop/check-audio', { track_ids: trackIds }),
  })
}

// ── Workshop state (save/load) ──────────────────────────────

export function useWorkshopState() {
  return useQuery({
    queryKey: workshopKeys.state,
    queryFn: () => api.get('/api/set-workshop/state').then(api.validated(WorkshopStateResponse)),
    staleTime: Infinity, // load once on mount
  })
}

export function useSaveWorkshopState() {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/set-workshop/state', body),
  })
}

// ── Saved sets CRUD ─────────────────────────────────────────

export function useSavedSets() {
  return useQuery({
    queryKey: workshopKeys.savedSets,
    queryFn: () =>
      api
        .get('/api/saved-sets')
        .then(api.validated(SavedSetListResponse))
        .then((r) => r.sets),
  })
}

export function useSavedSet(id: string | null) {
  return useQuery({
    queryKey: workshopKeys.savedSet(id ?? ''),
    queryFn: () => api.get(`/api/saved-sets/${id}`).then(api.validated(SavedSetDetail)),
    enabled: id != null,
  })
}

export function useCreateSavedSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; slots: Record<string, unknown>[] }) =>
      api.post<{ id: string; name: string }>('/api/saved-sets', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workshopKeys.savedSets })
    },
  })
}

export function useUpdateSavedSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      name?: string
      slots?: Record<string, unknown>[]
    }) => api.put('/api/saved-sets/' + id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workshopKeys.savedSets })
    },
  })
}

// ── Export M3U ───────────────────────────────────────────────

export function useExportM3u() {
  return useMutation({
    mutationFn: async (body: { slots: Record<string, unknown>[]; name: string }) => {
      const res = await fetch('/api/set-workshop/export-m3u', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Export failed')
      return res.blob()
    },
  })
}
