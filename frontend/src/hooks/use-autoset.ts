import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { SuccessResponse } from '@/schemas'

export function useAutosetBuild() {
  return useMutation({
    mutationFn: (body: {
      source_type: string
      source_id: string
      tree_type?: string
      phase_profile_id: string
      set_name?: string
    }) => api.post('/api/autoset/build', body).then(api.validated(SuccessResponse)),
  })
}

export function useAutosetStop() {
  return useMutation({
    mutationFn: () => api.post('/api/autoset/stop'),
  })
}

export function useAutosetResult() {
  return useMutation({
    mutationFn: () => api.get('/api/autoset/result'),
  })
}
