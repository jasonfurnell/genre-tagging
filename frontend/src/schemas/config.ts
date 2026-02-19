import { z } from 'zod'

export const AppConfig = z.object({
  model: z.string(),
  system_prompt: z.string(),
  user_prompt_template: z.string(),
  delay_between_requests: z.number(),
  audio_path_map_enabled: z.boolean().optional(),
  audio_path_from: z.string().optional(),
  audio_path_to: z.string().optional(),
  dropbox_path_prefix: z.string().optional(),
})

export const ConfigUpdate = z.object({
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  user_prompt_template: z.string().optional(),
  delay_between_requests: z.number().optional(),
  audio_path_map_enabled: z.boolean().optional(),
  audio_path_from: z.string().optional(),
  audio_path_to: z.string().optional(),
  dropbox_path_prefix: z.string().optional(),
})

export type AppConfig = z.infer<typeof AppConfig>
export type ConfigUpdate = z.infer<typeof ConfigUpdate>
