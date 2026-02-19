import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PhaseProfileListResponse, PhaseProfile } from '@/schemas'

export const phaseKeys = {
  all: ['phase-profiles'] as const,
  detail: (id: string) => ['phase-profiles', id] as const,
}

export function usePhaseProfiles() {
  return useQuery({
    queryKey: phaseKeys.all,
    queryFn: () =>
      api
        .get('/api/phase-profiles')
        .then(api.validated(PhaseProfileListResponse))
        .then((r) => r.profiles),
  })
}

export function usePhaseProfile(id: string | null) {
  return useQuery({
    queryKey: phaseKeys.detail(id ?? ''),
    queryFn: () => api.get(`/api/phase-profiles/${id}`).then(api.validated(PhaseProfile)),
    enabled: id != null,
  })
}

export function useCreatePhaseProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string
      description?: string
      phases: { name: string; pct: [number, number]; desc: string; color: string }[]
    }) => api.post<PhaseProfile>('/api/phase-profiles', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: phaseKeys.all })
    },
  })
}

export function useUpdatePhaseProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      name?: string
      description?: string
      phases?: { name: string; pct: [number, number]; desc: string; color: string }[]
    }) => api.put<PhaseProfile>(`/api/phase-profiles/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: phaseKeys.all })
      qc.invalidateQueries({ queryKey: phaseKeys.detail(variables.id) })
    },
  })
}

export function useDeletePhaseProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/phase-profiles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: phaseKeys.all })
    },
  })
}

export function useDuplicatePhaseProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.post<PhaseProfile>(`/api/phase-profiles/${id}/duplicate`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: phaseKeys.all })
    },
  })
}
