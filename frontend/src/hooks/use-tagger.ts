import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { TagSingleResponse, UploadSummary } from '@/schemas'
import { trackKeys } from '@/hooks/use-tracks'

export function useTagAll() {
  return useMutation({
    mutationFn: () => api.post<{ started: boolean }>('/api/tag'),
  })
}

export function useStopTagging() {
  return useMutation({
    mutationFn: () => api.post<{ stopped: boolean }>('/api/tag/stop'),
  })
}

export function useRetagTrack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (trackId: number) =>
      api.post(`/api/tag/${trackId}`).then(api.validated(TagSingleResponse)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trackKeys.all })
    },
  })
}

export function useUpdateTrackComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ trackId, comment }: { trackId: number; comment: string }) =>
      api.put<{ id: number; comment: string }>(`/api/track/${trackId}`, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trackKeys.all })
    },
  })
}

export function useClearTrack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (trackId: number) => api.post<{ id: number }>(`/api/track/${trackId}/clear`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trackKeys.all })
    },
  })
}

export function useClearAllTracks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ cleared: boolean }>('/api/tracks/clear-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trackKeys.all })
    },
  })
}

export function useUploadCsv() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload('/api/upload', form).then(api.validated(UploadSummary))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trackKeys.all })
    },
  })
}
