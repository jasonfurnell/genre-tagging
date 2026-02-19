import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AppConfig, type ConfigUpdate } from '@/schemas'

export const configKeys = {
  all: ['config'] as const,
}

export function useConfig() {
  return useQuery({
    queryKey: configKeys.all,
    queryFn: () => api.get('/api/config').then(api.validated(AppConfig)),
  })
}

export function useUpdateConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (update: ConfigUpdate) =>
      api.put('/api/config', update).then(api.validated(AppConfig)),
    onSuccess: (data) => {
      queryClient.setQueryData(configKeys.all, data)
    },
  })
}
