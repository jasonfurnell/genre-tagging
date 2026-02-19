import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  PlaylistListResponse,
  PlaylistDetailResponse,
  SmartCreateResponse,
  ImportResponse,
} from '@/schemas'
import type { Playlist, PlaylistFilters } from '@/schemas'

export const playlistKeys = {
  all: ['playlists'] as const,
  detail: (id: string) => ['playlists', id] as const,
  analysis: ['playlist-analysis'] as const,
}

export function usePlaylists() {
  return useQuery({
    queryKey: playlistKeys.all,
    queryFn: () =>
      api
        .get('/api/workshop/playlists')
        .then(api.validated(PlaylistListResponse))
        .then((r) => r.playlists),
  })
}

export function usePlaylistDetail(id: string | null) {
  return useQuery({
    queryKey: playlistKeys.detail(id ?? ''),
    queryFn: () =>
      api.get(`/api/workshop/playlists/${id}`).then(api.validated(PlaylistDetailResponse)),
    enabled: id != null,
  })
}

export function useCreatePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string
      description?: string
      filters?: PlaylistFilters
      track_ids?: number[]
      source?: string
    }) => api.post<{ playlist: Playlist }>('/api/workshop/playlists', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: playlistKeys.all })
    },
  })
}

export function useUpdatePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      name?: string
      description?: string
      filters?: PlaylistFilters
    }) => api.put<{ playlist: Playlist }>(`/api/workshop/playlists/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: playlistKeys.all })
      qc.invalidateQueries({ queryKey: playlistKeys.detail(variables.id) })
    },
  })
}

export function useDeletePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/workshop/playlists/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: playlistKeys.all })
    },
  })
}

export function useAddPlaylistTracks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, track_ids }: { id: string; track_ids: number[] }) =>
      api.post<{ playlist: Playlist }>(`/api/workshop/playlists/${id}/tracks`, { track_ids }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: playlistKeys.all })
      qc.invalidateQueries({ queryKey: playlistKeys.detail(variables.id) })
    },
  })
}

export function useRemovePlaylistTracks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, track_ids }: { id: string; track_ids: number[] }) =>
      api.delete<{ playlist: Playlist }>(`/api/workshop/playlists/${id}/tracks`, { track_ids }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: playlistKeys.all })
      qc.invalidateQueries({ queryKey: playlistKeys.detail(variables.id) })
    },
  })
}

export function useSmartCreatePlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string
      description?: string
      filters: PlaylistFilters
      target_count?: number
    }) =>
      api
        .post('/api/workshop/playlists/smart-create', body)
        .then(api.validated(SmartCreateResponse)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: playlistKeys.all })
    },
  })
}

export function useImportPlaylist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.upload<ImportResponse>('/api/workshop/playlists/import', fd)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: playlistKeys.all })
    },
  })
}
