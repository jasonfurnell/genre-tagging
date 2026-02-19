import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'
import { TrackRow, UploadSummary } from '@/schemas'
import { useUiStore } from '@/stores/ui'

export const trackKeys = {
  all: ['tracks'] as const,
  upload: ['upload'] as const,
}

export function useTracks() {
  return useQuery({
    queryKey: trackKeys.all,
    queryFn: () => api.get('/api/tracks').then(api.validated(z.array(TrackRow))),
    enabled: useUiStore.getState().hasData,
  })
}

export function useUpload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload('/api/upload', form).then(api.validated(UploadSummary))
    },
    onSuccess: () => {
      useUiStore.getState().setHasData(true)
      queryClient.invalidateQueries({ queryKey: trackKeys.all })
    },
  })
}

export function useRestore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.get('/api/restore').then(api.validated(UploadSummary)),
    onSuccess: (data) => {
      if (data.total > 0) {
        useUiStore.getState().setHasData(true)
        queryClient.invalidateQueries({ queryKey: trackKeys.all })
      }
    },
  })
}
