import { z } from 'zod'

export const Phase = z.object({
  name: z.string(),
  pct: z.tuple([z.number(), z.number()]),
  desc: z.string(),
  color: z.string(),
})

export const PhaseProfile = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  is_default: z.boolean(),
  phases: z.array(Phase),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const PhaseProfileListResponse = z.object({
  profiles: z.array(PhaseProfile),
})

export type Phase = z.infer<typeof Phase>
export type PhaseProfile = z.infer<typeof PhaseProfile>
export type PhaseProfileListResponse = z.infer<typeof PhaseProfileListResponse>
