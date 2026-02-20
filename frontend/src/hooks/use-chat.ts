import { useQuery, useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'
import { SuccessResponse } from '@/schemas'

const ChatHistoryResponse = z.object({
  messages: z.array(
    z.object({
      role: z.string(),
      text: z.string(),
    }),
  ),
})

export const chatKeys = {
  history: ['chat-history'] as const,
}

export function useChatHistory() {
  return useQuery({
    queryKey: chatKeys.history,
    queryFn: () => api.get('/api/chat/history').then(api.validated(ChatHistoryResponse)),
  })
}

export function useSendMessage() {
  return useMutation({
    mutationFn: (message: string) =>
      api.post('/api/chat/message', { message }).then(api.validated(SuccessResponse)),
  })
}

export function useChatStop() {
  return useMutation({
    mutationFn: () => api.post('/api/chat/stop'),
  })
}

export function useChatClear() {
  return useMutation({
    mutationFn: () => api.post('/api/chat/clear'),
  })
}
