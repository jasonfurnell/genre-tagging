import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { SavedSetListResponse, SavedSetDetail } from '@/schemas'

export const setKeys = {
  all: ['saved-sets'] as const,
  detail: (id: string) => ['saved-sets', id] as const,
}

export function useSavedSets() {
  return useQuery({
    queryKey: setKeys.all,
    queryFn: () =>
      api
        .get('/api/saved-sets')
        .then(api.validated(SavedSetListResponse))
        .then((r) => r.sets),
  })
}

export function useSavedSet(id: string | null) {
  return useQuery({
    queryKey: setKeys.detail(id ?? ''),
    queryFn: () => api.get(`/api/saved-sets/${id}`).then(api.validated(SavedSetDetail)),
    enabled: id != null,
  })
}

export function useCreateSet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; slots: Record<string, unknown>[] }) =>
      api.post<SavedSetDetail>('/api/saved-sets', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: setKeys.all })
    },
  })
}

export function useUpdateSet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      name?: string
      slots?: Record<string, unknown>[]
    }) => api.put<SavedSetDetail>(`/api/saved-sets/${id}`, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: setKeys.all })
      queryClient.invalidateQueries({ queryKey: setKeys.detail(variables.id) })
    },
  })
}

export function useDeleteSet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/saved-sets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: setKeys.all })
    },
  })
}
